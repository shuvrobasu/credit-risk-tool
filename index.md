# File Index and Syntax Structure

## Configuration Files
### [.dockerignore](file:///f:/credit_tool/.dockerignore)
- **Type**: Docker Ignore File
- **Summary**: Specifies files and directories to be ignored by Docker.

## Backend Router Files
### [ai_chat.py](file:///f:/credit_tool/backend/routers/ai_chat.py)
- **Classes**:
  - `ChatMessage(BaseModel)`
  - `ChatRequest(BaseModel)`
- **Endpoints**:
  - `POST /chat`: `chat_with_llama`
- **Globals**:
  - `SYSTEM_PROMPT`

### [app_settings.py](file:///f:/credit_tool/backend/routers/app_settings.py)
- **Classes**:
  - `SettingUpdate(BaseModel)`
- **Endpoints**:
  - `GET /`: `get_all_settings`
  - `PATCH /{key}`: `update_setting`
  - `POST /bulk`: `update_settings_bulk`
  - `GET /theme`: `get_theme`
  - `POST /theme`: `save_theme`

## Backend Utility and Engine Files
### [check_settings.py](file:///f:/credit_tool/backend/check_settings.py)
- **Type**: Standalone Script
- **Summary**: Queries and prints current application and scoring settings.

### [tools.py](file:///f:/credit_tool/backend/ai/tools.py)
- **Functions**:
  - `execute_tool_call`
  - `_resolve_customer_id`
  - `_get_customer_risk_profile`
  - `_get_score_history`
  - `_get_invoice_summary`
  - `_get_dunning_status`
  - `_get_portfolio_summary`
  - `_get_payment_history`
  - `_get_customers_by_status`
  - `_search_customers`
- **Globals**:
  - `AI_TOOLS`

### [engine.py](file:///f:/credit_tool/backend/dunning/engine.py)
- **Functions**:
  - `_get_active_config`
  - `_resolve_ladder_key`
  - `_resolve_ladder_key_for_invoice`
  - `_get_ladder_steps`
  - `_already_sent`
  - `_get_due_steps`
  - `_log_dunning`
  - `evaluate_invoice`
  - `evaluate_customer`
  - `run_portfolio_dunning`
