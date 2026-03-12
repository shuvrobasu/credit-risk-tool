from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models.tables import SystemHealth
from typing import List
from pydantic import BaseModel
from datetime import datetime

router = APIRouter()

class HealthEntry(BaseModel):
    key: str
    value: str
    last_updated: datetime
    status: str

@router.get("", response_model=List[HealthEntry])
def get_system_health(db: Session = Depends(get_db)):
    return db.query(SystemHealth).all()
