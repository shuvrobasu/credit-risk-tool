from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from sqlalchemy import select
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import httpx
import json
import asyncio
from decimal import Decimal

from database import get_db
from models.tables import AiConfig
from ai.tools import AI_TOOLS, execute_tool_call

router = APIRouter()

class ChatMessage(BaseModel):
    role: str
    content: str
    name: Optional[str] = None
    tool_calls: Optional[List[Dict[Any, Any]]] = None

class ChatRequest(BaseModel):
    messages: List[ChatMessage]

SYSTEM_PROMPT = """You are the CreditTool AI Assistant. You help credit managers analyze customer risk, review AR ledgers, and check portfolio health.
You have access to several tools that query the live PostgreSQL database. If a user asks a question about a specific customer or global AR data, YOU MUST USE THE TOOLS to look up the data before answering.
Once a tool returns data, summarize it clearly and concisely for the user. Do not make up or fabricate any customer data. Only report data returned by the tools.

System Context (Tool Selection Guide):
- For identifying customers with specific invoice statuses (e.g., 'disputed', 'overdue', 'open') → use get_customers_by_invoice_status
- For risk scores, risk bands, credit limits → use get_customer_risk_profile
- For score trends over time → use get_score_history
- For invoice balances, open AR, overdue invoices → use get_invoice_summary
- For payment history, late payments, missed payments, DPD, days to pay → use get_payment_history
- For dunning/collections status → use get_dunning_status
- For portfolio-wide summaries → use get_portfolio_summary
- If you are unsure of a customer's exact ID or code → use search_customers
"""

@router.post("/chat")
async def chat_with_llama(req: ChatRequest, db: Session = Depends(get_db)):
    # 1. Fetch active AI config
    config = db.execute(select(AiConfig).where(AiConfig.is_active == True)).scalars().first()
    if not config:
        raise HTTPException(status_code=500, detail="No active AI Configuration found. Please set one up in the AI Settings.")

    llama_url = f"http://{config.llama_cpp_host}:{config.llama_cpp_port}/v1/chat/completions"

    # 2. Build the message array with the system prompt
    internal_messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    
    is_mistral = "mistral" in config.model_path.lower()
    
    # Mistral crashes if the first chat message is an assistant role
    # So we skip the frontend's hardcoded initial welcome message
    first_user_found = False
    
    for msg in req.messages:
        cleaned = {k: v for k, v in msg.dict().items() if v is not None}
        
        if is_mistral and not first_user_found:
            if cleaned["role"] == "user":
                first_user_found = True
            elif cleaned["role"] == "assistant":
                continue # Skip assistant messages before the first user message
                
        internal_messages.append(cleaned)

    # 3. Create the payload for llama.cpp compatible server
    payload = {
        "model": config.model_path,
        "messages": internal_messages,
        "tools": AI_TOOLS,
        "temperature": config.temperature,
        "max_tokens": config.max_tokens
    }
    
    # Custom encoder for Decimals
    def _json_encoder(obj):
        if isinstance(obj, Decimal):
            return float(obj)
        raise TypeError(f"Object of type {type(obj)} is not JSON serializable")

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            # Send using content to allow custom json dumps passing Decimal
            response = await client.post(
                llama_url, 
                content=json.dumps(payload, default=_json_encoder),
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status()
            data = response.json()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to connect to local LLM: {str(e)}")

    message = data["choices"][0]["message"]
    
    # 4. Check if the LLM requested a tool call
    if message.get("tool_calls"):
        
        # For Mistral, appending a raw message with 'tool_calls' crashes the Jinja template on pass 2
        # if the 'tools' array is missing. We must strip the 'tool_calls' from the context history.
        if is_mistral:
            internal_messages.append({
                "role": "assistant",
                "content": "Querying database tool..."
            })
        else:
            # Append standard OpenAI assistant's tool intent to the thread
            internal_messages.append(message)
        
        # Execute each tool requested sequentially
        mistral_tool_results = []
        for tool_call in message["tool_calls"]:
            func_name = tool_call["function"]["name"]
            try:
                args = json.loads(tool_call["function"]["arguments"])
            except:
                args = {}
            # Run our Python backend code querying SQL
            tool_result_str = execute_tool_call(db, func_name, args)
            
            if is_mistral:
                mistral_tool_results.append(f"Result for {func_name}: {tool_result_str}")
            else:
                # Standard OpenAI role formatting
                internal_messages.append({
                    "role": "tool",
                    "name": func_name,
                    "content": tool_result_str,
                    "tool_call_id": tool_call.get("id", "call_0")
                })
        
        if is_mistral and mistral_tool_results:
            combined_results = "\n".join(mistral_tool_results)
            internal_messages.append({
                "role": "user",
                "content": f"System Context (Tool Results):\n{combined_results}"
            })
            
        # Recursive secondary call back to LLM to summarize the tool outputs
        payload["messages"] = internal_messages
        
        if is_mistral:
            # We strip tools for the final reply in Mistral to ensure it forces a text answer
            payload.pop("tools", None)
            payload.pop("tool_choice", None)
        
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                second_response = await client.post(
                    llama_url, 
                    content=json.dumps(payload, default=_json_encoder),
                    headers={"Content-Type": "application/json"}
                )
                second_response.raise_for_status()
                final_data = second_response.json()
                return {"message": final_data["choices"][0]["message"], "tool_executed": True}
            except Exception as e:
                raise HTTPException(status_code=502, detail=f"Failed on second LLM summary pass: {str(e)}")
                
    else:
        # Just return standard chat text
        return {"message": message, "tool_executed": False}
