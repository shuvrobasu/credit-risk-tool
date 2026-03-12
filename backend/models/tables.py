import uuid
from datetime import datetime, date
from sqlalchemy import (
    Column, String, Integer, SmallInteger, Numeric, Boolean,
    Date, DateTime, Text, ForeignKey, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from database import Base


def new_uuid():
    return str(uuid.uuid4())


# --- Table 1: customers ---
class Customer(Base):
    __tablename__ = "customers"

    customer_id             = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    customer_code           = Column(String(50), unique=True, nullable=False)
    customer_name           = Column(String(255), nullable=False)
    country                 = Column(String(100))
    currency                = Column(String(10))
    customer_category       = Column(String(50))
    credit_limit            = Column(Numeric(18, 2))
    credit_limit_updated_at = Column(DateTime)
    dnb_paydex_score        = Column(SmallInteger)
    dnb_score_date          = Column(Date)
    contact_person          = Column(String(255))         # Read-only from master file
    contact_person_manual   = Column(String(255))         # Manual override
    use_manual_contact      = Column(Boolean, default=False) 
    exclude_from_dunning    = Column(Boolean, default=False) # Skip for legal/special cases
    dunning_mode            = Column(String(20), default="fixed") # 'fixed' or 'ai'
    is_active               = Column(Boolean, default=True)
    created_at              = Column(DateTime, default=datetime.utcnow)
    updated_at              = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    invoices                = relationship("Invoice", back_populates="customer")
    payments                = relationship("Payment", back_populates="customer")
    risk_scores             = relationship("CustomerRiskScore", back_populates="customer")
    collections             = relationship("CollectionsHistory", back_populates="customer")


# --- Table 2: invoices ---
class Invoice(Base):
    __tablename__ = "invoices"

    invoice_id            = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    customer_id           = Column(UUID(as_uuid=False), ForeignKey("customers.customer_id"), nullable=False)
    invoice_number        = Column(String(100), unique=True, nullable=False)
    invoice_date          = Column(Date, nullable=False)
    due_date              = Column(Date, nullable=False)
    payment_terms         = Column(String(50))
    invoice_amount        = Column(Numeric(18, 2), nullable=False)
    currency              = Column(String(10))
    reporting_currency    = Column(String(10))
    exchange_rate         = Column(Numeric(18, 6))
    exchange_rate_source  = Column(String(20))          # erp/rates_table/manual
    outstanding_amount    = Column(Numeric(18, 2))
    status                = Column(String(30))          # open/partial/paid/written_off/in_collections
    dispute_flag          = Column(Boolean, default=False)
    dispute_reason        = Column(Text)
    dispute_category      = Column(String(50))          # Pricing, Quality, Logistics, etc.
    dispute_opened_at     = Column(DateTime)
    promise_to_pay_date   = Column(Date)
    created_at            = Column(DateTime, default=datetime.utcnow)
    updated_at            = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    customer              = relationship("Customer", back_populates="invoices")
    payments              = relationship("Payment", back_populates="invoice")
    risk_flags            = relationship("InvoiceRiskFlag", back_populates="invoice")
    dunning_logs          = relationship("DunningLog", back_populates="invoice")
    collections           = relationship("CollectionsHistory", back_populates="invoice")


# --- Table 3: payments ---
class Payment(Base):
    __tablename__ = "payments"

    payment_id            = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    invoice_id            = Column(UUID(as_uuid=False), ForeignKey("invoices.invoice_id"), nullable=False)
    customer_id           = Column(UUID(as_uuid=False), ForeignKey("customers.customer_id"), nullable=False)
    payment_date          = Column(Date, nullable=False)
    payment_amount        = Column(Numeric(18, 2), nullable=False)
    payment_method        = Column(String(50))
    reference_number      = Column(String(100))
    days_to_pay           = Column(Integer)
    days_past_due         = Column(Integer)
    created_at            = Column(DateTime, default=datetime.utcnow)

    invoice               = relationship("Invoice", back_populates="payments")
    customer              = relationship("Customer", back_populates="payments")


# --- Table 4: customer_risk_scores ---
class CustomerRiskScore(Base):
    __tablename__ = "customer_risk_scores"

    score_id                  = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    customer_id               = Column(UUID(as_uuid=False), ForeignKey("customers.customer_id"), nullable=False)
    score_date                = Column(Date, nullable=False)
    behavioral_score          = Column(Numeric(6, 2))
    anchor_score              = Column(Numeric(6, 2))
    business_adjusted_score   = Column(Numeric(6, 2))
    risk_band                 = Column(String(20))
    credit_utilization_ratio  = Column(Numeric(10, 4))
    terms_adherence_ratio     = Column(Numeric(10, 4))
    delinquency_severity_idx  = Column(Numeric(12, 2))
    weighted_avg_daysoverdue  = Column(Numeric(12, 2))
    open_ar_balance           = Column(Numeric(18, 2))
    score_trigger             = Column(String(50))
    config_version            = Column(Integer, ForeignKey("scoring_config.config_id"))
    is_stale                  = Column(Boolean, default=False)
    created_at                = Column(DateTime, default=datetime.utcnow)

    customer                  = relationship("Customer", back_populates="risk_scores")
    config                    = relationship("ScoringConfig", back_populates="risk_scores")


# --- Table 5: invoice_risk_flags ---
class InvoiceRiskFlag(Base):
    __tablename__ = "invoice_risk_flags"

    flag_id               = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    invoice_id            = Column(UUID(as_uuid=False), ForeignKey("invoices.invoice_id"), nullable=False)
    customer_id           = Column(UUID(as_uuid=False), ForeignKey("customers.customer_id"), nullable=False)
    flag_type             = Column(String(50))
    flag_severity         = Column(String(20))
    flag_message          = Column(Text)
    resolved              = Column(Boolean, default=False)
    resolved_at           = Column(DateTime)
    created_at            = Column(DateTime, default=datetime.utcnow)

    invoice               = relationship("Invoice", back_populates="risk_flags")


# --- Table 6: collections_history ---
class CollectionsHistory(Base):
    __tablename__ = "collections_history"

    collection_id         = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    customer_id           = Column(UUID(as_uuid=False), ForeignKey("customers.customer_id"), nullable=False)
    invoice_id            = Column(UUID(as_uuid=False), ForeignKey("invoices.invoice_id"), nullable=True)
    action_type           = Column(String(50))
    action_date           = Column(Date, nullable=False)
    action_by             = Column(String(100))
    amount_at_risk        = Column(Numeric(18, 2))
    amount_recovered      = Column(Numeric(18, 2))
    recovery_date         = Column(Date)
    sent_to_3p            = Column(Boolean, default=False)
    third_party_agency    = Column(String(255))
    outcome               = Column(String(50))
    notes                 = Column(Text)
    created_at            = Column(DateTime, default=datetime.utcnow)

    customer              = relationship("Customer", back_populates="collections")
    invoice               = relationship("Invoice", back_populates="collections")


# --- Table 7: dunning_log ---
class DunningLog(Base):
    __tablename__ = "dunning_log"

    dunning_id            = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    invoice_id            = Column(UUID(as_uuid=False), ForeignKey("invoices.invoice_id"), nullable=False)
    customer_id           = Column(UUID(as_uuid=False), ForeignKey("customers.customer_id"), nullable=False)
    dunning_step          = Column(SmallInteger)
    template_id           = Column(UUID(as_uuid=False), ForeignKey("dunning_templates.template_id"), nullable=True)
    sent_at               = Column(DateTime)
    sent_via              = Column(String(30))
    sent_to               = Column(Text)                            # comma-separated TO addresses
    sent_cc               = Column(Text)                            # comma-separated CC addresses
    delivery_status       = Column(String(30))
    days_past_due_at_send = Column(Integer)
    rendered_subject      = Column(Text)                             # exact subject sent
    rendered_body         = Column(Text)                             # exact HTML body sent
    created_at            = Column(DateTime, default=datetime.utcnow)

    invoice               = relationship("Invoice", back_populates="dunning_logs")
    template              = relationship("DunningTemplate", back_populates="dunning_logs")


# --- Table 8: dunning_templates ---
class DunningTemplate(Base):
    __tablename__ = "dunning_templates"

    template_id           = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    template_name         = Column(String(255))
    dunning_step          = Column(SmallInteger)
    customer_category     = Column(String(50))
    subject_line          = Column(Text)
    body_template         = Column(Text)
    is_active             = Column(Boolean, default=True)
    created_by            = Column(String(100))
    created_at            = Column(DateTime, default=datetime.utcnow)
    updated_at            = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    dunning_logs          = relationship("DunningLog", back_populates="template")


# --- Table 9: scoring_config ---
class ScoringConfig(Base):
    __tablename__ = "scoring_config"

    config_id                  = Column(Integer, primary_key=True, autoincrement=True)
    config_name                = Column(String(255))
    is_active                  = Column(Boolean, default=False)
    ladder_assignment_mode     = Column(String(30), default="payment_terms")  # payment_terms/customer_category/risk_band/custom
    weight_dsi                 = Column(Numeric(5, 4))
    weight_tar                 = Column(Numeric(5, 4))
    weight_ispv                = Column(Numeric(5, 4))
    weight_cur                 = Column(Numeric(5, 4))
    weight_crh                 = Column(Numeric(5, 4))
    weight_3pc                 = Column(Numeric(5, 4))
    weight_dnb                 = Column(Numeric(5, 4))
    dnb_decay_months           = Column(SmallInteger)
    threepc_decay_months       = Column(SmallInteger)
    default_new_customer_score = Column(Numeric(6, 2))
    min_invoice_threshold      = Column(SmallInteger)
    crh_rolling_months         = Column(SmallInteger)
    band_green_floor           = Column(Numeric(6, 2))
    band_amber_floor           = Column(Numeric(6, 2))
    band_red_floor             = Column(Numeric(6, 2))
    dunning_day1               = Column(SmallInteger, default=7)
    dunning_day2               = Column(SmallInteger, default=15)
    dunning_day3               = Column(SmallInteger, default=30)
    dunning_day4               = Column(SmallInteger, default=45)
    dunning_mode               = Column(String(20), default="fixed") # global default
    dunning_level              = Column(String(20), default="invoice") # 'invoice' or 'customer'
    created_by                 = Column(String(100))
    created_at                 = Column(DateTime, default=datetime.utcnow)

    dunning_steps              = relationship("DunningConfigStep", back_populates="config")
    risk_scores                = relationship("CustomerRiskScore", back_populates="config")


# --- Table 10: dunning_config_steps ---
class DunningConfigStep(Base):
    __tablename__ = "dunning_config_steps"

    step_id               = Column(Integer, primary_key=True, autoincrement=True)
    config_id             = Column(Integer, ForeignKey("scoring_config.config_id"), nullable=False)
    ladder_key            = Column(String(100), default="default")  # Net30/Net60/strategic/red/default etc
    step_number           = Column(SmallInteger, nullable=False)
    trigger_offset        = Column(SmallInteger, nullable=False)
    step_label            = Column(String(100))
    step_type             = Column(String(50))                      # pre_due/post_due/escalation/collections
    penalty_weight        = Column(Numeric(5, 4))
    template_id           = Column(UUID(as_uuid=False), ForeignKey("dunning_templates.template_id"), nullable=True)

    config                = relationship("ScoringConfig", back_populates="dunning_steps")

    __table_args__ = (
        UniqueConstraint("config_id", "ladder_key", "step_number", name="uq_config_ladder_step"),
    )


# --- Table 11: data_import_log ---
class DataImportLog(Base):
    __tablename__ = "data_import_log"

    import_id             = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    import_type           = Column(String(50))
    source                = Column(String(100))
    total_records         = Column(Integer)
    success_records       = Column(Integer)
    failed_records        = Column(Integer)
    error_detail          = Column(JSONB)
    imported_by           = Column(String(100))
    imported_at           = Column(DateTime, default=datetime.utcnow)


# --- Table 12: currency_rates ---
class CurrencyRate(Base):
    __tablename__ = "currency_rates"

    rate_id               = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    from_currency         = Column(String(10), nullable=False)
    to_currency           = Column(String(10), nullable=False)
    rate                  = Column(Numeric(18, 6), nullable=False)
    effective_date        = Column(Date, nullable=False)
    source                = Column(String(20))                      # manual/erp/feed
    created_at            = Column(DateTime, default=datetime.utcnow)


# --- Table 13: email_config ---
class EmailConfig(Base):
    __tablename__ = "email_config"

    email_config_id       = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    config_name           = Column(String(100))
    smtp_host             = Column(String(255))
    smtp_port             = Column(SmallInteger)
    smtp_user             = Column(String(255))
    smtp_password         = Column(Text)
    use_tls               = Column(Boolean, default=True)
    from_name             = Column(String(255))
    from_address          = Column(String(255))
    reply_to              = Column(String(255))
    default_to            = Column(Text)
    default_cc            = Column(Text)
    company_name          = Column(String(255))
    reporting_currency    = Column(String(10))
    is_active             = Column(Boolean, default=True)
    created_at            = Column(DateTime, default=datetime.utcnow)
    updated_at            = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    signature_html        = Column(Text, nullable=True)


# --- Table 14: import_field_mapping ---
class ImportFieldMapping(Base):
    __tablename__ = "import_field_mapping"

    mapping_id            = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    mapping_name          = Column(String(255))
    source_type           = Column(String(50))                      # csv/excel/json/erp_api
    target_table          = Column(String(100))
    source_field          = Column(String(255))
    target_field          = Column(String(100))
    transform_rule        = Column(Text)
    is_required           = Column(Boolean, default=False)
    default_value         = Column(Text)
    created_at            = Column(DateTime, default=datetime.utcnow)
    updated_at            = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# --- ERP Pro Feature Tables ---
class ErpConnection(Base):
    __tablename__ = "erp_connections"

    connection_id         = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    erp_type              = Column(String(50))
    integration_mode      = Column(String(20))
    base_url              = Column(Text)
    auth_type             = Column(String(20))
    credentials           = Column(JSONB)
    sync_frequency_mins   = Column(SmallInteger)
    last_sync_at          = Column(DateTime)
    is_active             = Column(Boolean, default=True)

    field_mappings        = relationship("FieldMappingConfig", back_populates="connection")
    sync_logs             = relationship("ErpSyncLog", back_populates="connection")


class FieldMappingConfig(Base):
    __tablename__ = "field_mapping_config"

    mapping_id            = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    connection_id         = Column(UUID(as_uuid=False), ForeignKey("erp_connections.connection_id"), nullable=False)
    erp_entity            = Column(String(100))
    erp_field             = Column(String(100))
    credit_tool_table     = Column(String(100))
    credit_tool_field     = Column(String(100))
    transform_rule        = Column(Text)

    connection            = relationship("ErpConnection", back_populates="field_mappings")


class ApiKey(Base):
    __tablename__ = "api_keys"

    api_key_id            = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    key_hash              = Column(String(255))
    label                 = Column(String(100))
    scopes                = Column(JSONB)
    rate_limit_per_min    = Column(SmallInteger)
    last_used_at          = Column(DateTime)
    is_active             = Column(Boolean, default=True)


class ErpSyncLog(Base):
    __tablename__ = "erp_sync_log"

    sync_log_id           = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    connection_id         = Column(UUID(as_uuid=False), ForeignKey("erp_connections.connection_id"), nullable=False)
    sync_mode             = Column(String(20))
    records_fetched       = Column(Integer)
    records_inserted      = Column(Integer)
    records_failed        = Column(Integer)
    error_detail          = Column(JSONB)
    synced_at             = Column(DateTime, default=datetime.utcnow)

    connection            = relationship("ErpConnection", back_populates="sync_logs")


# --- AI Config Table (M9) ---
class AiConfig(Base):
    __tablename__ = "ai_config"

    ai_config_id          = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    model_path            = Column(Text)
    model_type            = Column(String(50))
    context_length        = Column(Integer, default=4096)
    temperature           = Column(Numeric(3, 2), default=0.20)
    max_tokens            = Column(Integer, default=1024)
    llama_cpp_port        = Column(Integer, default=8002)
    llama_cpp_host        = Column(String(100), default="localhost")
    gpu_layers            = Column(Integer, default=-1)
    is_active             = Column(Boolean, default=True)
    updated_at            = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# --- Table 15: app_settings ---
class AppSettings(Base):
    __tablename__ = "app_settings"

    setting_key   = Column(String(100), primary_key=True)
    setting_value = Column(JSONB)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

# --- Table 16: dunning_worklist ---
class DunningWorklist(Base):
    __tablename__ = "dunning_worklist"

    work_id         = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    customer_id     = Column(UUID(as_uuid=False), ForeignKey("customers.customer_id"), nullable=False)
    invoice_id      = Column(UUID(as_uuid=False), ForeignKey("invoices.invoice_id"), nullable=True) # NULL means customer-level action
    suggested_action = Column(String(50))
    suggested_tone   = Column(String(50))
    priority        = Column(String(20))
    reason          = Column(Text)
    status          = Column(String(20), default="pending") # pending, approved, rejected, executed
    created_at      = Column(DateTime, default=datetime.utcnow)
    
    customer = relationship("Customer")
    invoice  = relationship("Invoice")

# --- Table 17: system_health ---
class SystemHealth(Base):
    __tablename__ = "system_health"

    key             = Column(String(100), primary_key=True)
    value           = Column(String(255))
    last_updated    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    status          = Column(String(20)) # success, fail

# --- Table 18: ui_column_mappings ---
class UIColumnMapping(Base):
    __tablename__ = "ui_column_mappings"

    mapping_id    = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    page_key      = Column(String(100), nullable=False) # e.g. "customers", "invoices"
    field_key     = Column(String(100), nullable=False) # e.g. "customer_name"
    display_name  = Column(String(100), nullable=False) # e.g. "Client"
    is_visible    = Column(Boolean, default=True)
    created_at    = Column(DateTime, default=datetime.utcnow)