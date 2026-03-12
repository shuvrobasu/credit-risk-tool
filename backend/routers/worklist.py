from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select
from database import get_db
from models.tables import DunningWorklist, Customer, Invoice
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

router = APIRouter()

class WorklistItem(BaseModel):
    work_id: str
    customer_id: str
    customer_name: str
    invoice_id: Optional[str] = None
    invoice_number: Optional[str] = None
    suggested_action: str
    suggested_tone: str
    priority: str
    reason: str
    status: str
    created_at: datetime

class ActionResponse(BaseModel):
    status: str
    new_status: str

@router.get("", response_model=List[WorklistItem])
def get_worklist(status: Optional[str] = "pending", db: Session = Depends(get_db)):
    query = select(DunningWorklist, Customer.customer_name, Invoice.invoice_number)\
        .join(Customer, DunningWorklist.customer_id == Customer.customer_id)\
        .outerjoin(Invoice, DunningWorklist.invoice_id == Invoice.invoice_id)
    
    if status:
        query = query.where(DunningWorklist.status == status)
    
    results = db.execute(query).all()
    
    out = []
    for row in results:
        w, c_name, i_num = row
        out.append(WorklistItem(
            work_id=str(w.work_id),
            customer_id=str(w.customer_id),
            customer_name=c_name,
            invoice_id=str(w.invoice_id) if w.invoice_id else None,
            invoice_number=i_num or "ACCOUNT LEVEL",
            suggested_action=w.suggested_action,
            suggested_tone=w.suggested_tone,
            priority=w.priority,
            reason=w.reason,
            status=w.status,
            created_at=w.created_at
        ))
    return out

@router.post("/{work_id}/action", response_model=ActionResponse)
def update_worklist_status(work_id: str, action: str, db: Session = Depends(get_db)):
    # action: approve, reject, stop
    item = db.query(DunningWorklist).filter(DunningWorklist.work_id == work_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found")
    
    if action == "approve":
        item.status = "approved"
    elif action == "reject":
        item.status = "rejected"
    elif action == "stop":
        item.status = "stopped"
    
    db.commit()
    return ActionResponse(status="success", new_status=item.status)

@router.delete("/clear")
def clear_worklist(db: Session = Depends(get_db)):
    """
    Purge all pending worklist items to allow a clean transition between hierarchy levels.
    """
    db.query(DunningWorklist).filter(DunningWorklist.status == "pending").delete()
    db.commit()
    return {"status": "success", "message": "Pending worklist cleared"}

