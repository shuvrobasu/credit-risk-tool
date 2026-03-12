from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select
from typing import List
from pydantic import BaseModel
from database import get_db
from models.tables import AiConfig

router = APIRouter()

class AiConfigBase(BaseModel):
    model_path: str
    model_type: str = "GGUF"
    context_length: int = 4096
    temperature: float = 0.20
    max_tokens: int = 1024
    llama_cpp_port: int = 8002
    llama_cpp_host: str = "localhost"
    gpu_layers: int = -1
    is_active: bool = True

class AiConfigResponse(AiConfigBase):
    ai_config_id: str

    class Config:
        from_attributes = True

@router.get("/", response_model=List[AiConfigResponse])
def get_ai_configs(db: Session = Depends(get_db)):
    configs = db.execute(select(AiConfig)).scalars().all()
    return configs

@router.get("/active", response_model=AiConfigResponse)
def get_active_ai_config(db: Session = Depends(get_db)):
    config = db.execute(select(AiConfig).where(AiConfig.is_active == True)).scalars().first()
    if not config:
        raise HTTPException(status_code=404, detail="No active AI configuration found")
    return config

@router.post("/", response_model=AiConfigResponse)
def create_ai_config(config_in: AiConfigBase, db: Session = Depends(get_db)):
    # If setting to active, deactivate others
    if config_in.is_active:
        active_configs = db.execute(select(AiConfig).where(AiConfig.is_active == True)).scalars().all()
        for idx in active_configs:
            idx.is_active = False
    
    db_config = AiConfig(**config_in.dict())
    db.add(db_config)
    db.commit()
    db.refresh(db_config)
    return db_config

@router.put("/{ai_config_id}", response_model=AiConfigResponse)
def update_ai_config(ai_config_id: str, config_in: AiConfigBase, db: Session = Depends(get_db)):
    db_config = db.execute(select(AiConfig).where(AiConfig.ai_config_id == ai_config_id)).scalars().first()
    if not db_config:
        raise HTTPException(status_code=404, detail="AI config not found")

    if config_in.is_active and not db_config.is_active:
         active_configs = db.execute(select(AiConfig).where(AiConfig.is_active == True)).scalars().all()
         for idx in active_configs:
             idx.is_active = False

    for cur_key, cur_val in config_in.dict().items():
        setattr(db_config, cur_key, cur_val)

    db.commit()
    db.refresh(db_config)
    return db_config
