from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import SessionLocal
from models.tables import UIColumnMapping, AppSettings, ScoringConfig
from pydantic import BaseModel
from typing import List

router = APIRouter(tags=["ui"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class MappingUpdate(BaseModel):
    page_key: str
    field_key: str
    display_name: str

@router.get("/", response_model=List[dict])
def get_mappings(db: Session = Depends(get_db)):
    mappings = db.query(UIColumnMapping).all()
    return [{"page": m.page_key, "field": m.field_key, "label": m.display_name} for m in mappings]

@router.post("/upsert")
def upsert_mapping(data: MappingUpdate, db: Session = Depends(get_db)):
    existing = db.query(UIColumnMapping).filter(
        UIColumnMapping.page_key == data.page_key,
        UIColumnMapping.field_key == data.field_key
    ).first()
    
    if existing:
        existing.display_name = data.display_name
    else:
        new_m = UIColumnMapping(
            page_key=data.page_key,
            field_key=data.field_key,
            display_name=data.display_name
        )
        db.add(new_m)
    db.commit()
    return {"status": "ok"}
