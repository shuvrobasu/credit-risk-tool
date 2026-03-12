# routers/import_mapping.py
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from database import get_db
from models.tables import ImportFieldMapping, DataImportLog

router = APIRouter()


# --- Pydantic Models ---

class MappingFieldIn(BaseModel):
    source_field:  str
    target_field:  str
    transform_rule: Optional[str] = None
    is_required:   bool = False
    default_value: Optional[str] = None


class MappingProfileIn(BaseModel):
    mapping_name:  str
    source_type:   str                    # csv/excel/json/erp_api
    target_table:  str                    # invoices/payments/customers
    fields:        List[MappingFieldIn]


class MappingFieldUpdate(BaseModel):
    source_field:  Optional[str] = None
    target_field:  Optional[str] = None
    transform_rule: Optional[str] = None
    is_required:   Optional[bool] = None
    default_value: Optional[str] = None


# --- Target field reference per table ---
TARGET_FIELDS = {
    "invoices": [
        "customer_code", "invoice_number", "invoice_date", "due_date", "payment_terms",
        "invoice_amount", "currency", "reporting_currency", "exchange_rate",
        "exchange_rate_source", "outstanding_amount", "status",
        "dispute_flag", "dispute_reason",
    ],
    "payments": [
        "invoice_number", "customer_code", "payment_date", "payment_amount", "payment_method",
        "reference_number", "days_to_pay", "days_past_due",
    ],
    "customers": [
        "customer_code", "customer_name", "country", "currency",
        "customer_category", "credit_limit", "dnb_paydex_score", "dnb_score_date",
    ],
    "dnb_scores": [
        "customer_code", "dnb_paydex_score", "dnb_score_date",
    ],
}

# --- ERP Templates ---
ERP_TEMPLATES = {
    "SAP": {
        "customer_code": "KUNNR",
        "invoice_number": "BELNR",
        "invoice_date": "BLDAT",
        "due_date": "ZFBDT",
        "invoice_amount": "WRBTR",
        "currency": "WAERS",
        "status": "STATU"
    },
    "Oracle": {
        "customer_code": "CUSTOMER_NUMBER",
        "invoice_number": "TRX_NUMBER",
        "invoice_date": "TRX_DATE",
        "due_date": "DUE_DATE",
        "invoice_amount": "AMOUNT_DUE_ORIGINAL",
        "currency": "INVOICE_CURRENCY_CODE"
    },
    "MS_Dynamics": {
        "customer_code": "AccountNum",
        "invoice_number": "InvoiceId",
        "invoice_date": "InvoiceDate",
        "due_date": "DueDate",
        "invoice_amount": "AmountCur",
        "currency": "CurrencyCode"
    }
}


# --- Transform rule reference ---
TRANSFORM_RULES = [
    {"rule": "date_format:YYYYMMDD",   "description": "Convert YYYYMMDD string to date"},
    {"rule": "date_format:DD/MM/YYYY", "description": "Convert DD/MM/YYYY string to date"},
    {"rule": "date_format:MM/DD/YYYY", "description": "Convert MM/DD/YYYY string to date"},
    {"rule": "divide_by_100",          "description": "Divide numeric value by 100"},
    {"rule": "multiply_by_100",        "description": "Multiply numeric value by 100"},
    {"rule": "uppercase",              "description": "Convert string to uppercase"},
    {"rule": "strip_whitespace",       "description": "Strip leading/trailing whitespace"},
    {"rule": "currency_convert",       "description": "Convert amount using currency_rates table"},
    {"rule": "boolean_yn",             "description": "Map Y/N string to True/False"},
    {"rule": "boolean_10",             "description": "Map 1/0 to True/False"},
]


def _serialize(m: ImportFieldMapping) -> dict:
    return {
        "mapping_id":    str(m.mapping_id),
        "mapping_name":  m.mapping_name,
        "source_type":   m.source_type,
        "target_table":  m.target_table,
        "source_field":  m.source_field,
        "target_field":  m.target_field,
        "transform_rule": m.transform_rule,
        "is_required":   m.is_required,
        "default_value": m.default_value,
        "created_at":    m.created_at.isoformat() if m.created_at else None,
        "updated_at":    m.updated_at.isoformat() if m.updated_at else None,
    }


def _group_by_profile(rows: List[ImportFieldMapping]) -> list:
    profiles = {}
    for r in rows:
        key = (r.mapping_name, r.source_type, r.target_table)
        if key not in profiles:
            profiles[key] = {
                "mapping_name": r.mapping_name,
                "source_type":  r.source_type,
                "target_table": r.target_table,
                "fields":       [],
            }
        profiles[key]["fields"].append(_serialize(r))
    return list(profiles.values())


# --- Endpoints ---

@router.get("/targets")
def get_target_fields():
    return {
        "target_tables": TARGET_FIELDS,
        "erp_templates": ERP_TEMPLATES
    }


@router.get("/transforms")
def get_transform_rules():
    return {"transform_rules": TRANSFORM_RULES}


@router.get("")
def list_profiles(
    target_table: Optional[str] = None,
    source_type:  Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(ImportFieldMapping)
    if target_table:
        q = q.filter(ImportFieldMapping.target_table == target_table)
    if source_type:
        q = q.filter(ImportFieldMapping.source_type == source_type)
    rows = q.order_by(ImportFieldMapping.mapping_name, ImportFieldMapping.target_field).all()
    return _group_by_profile(rows)


@router.get("/{mapping_id}")
def get_mapping(mapping_id: str, db: Session = Depends(get_db)):
    m = db.query(ImportFieldMapping).filter(ImportFieldMapping.mapping_id == mapping_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mapping not found")
    return _serialize(m)


@router.post("")
def create_profile(payload: MappingProfileIn, db: Session = Depends(get_db)):
    if payload.target_table not in TARGET_FIELDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid target_table. Must be one of: {list(TARGET_FIELDS.keys())}"
        )

    valid_targets = TARGET_FIELDS[payload.target_table]
    for f in payload.fields:
        if f.target_field not in valid_targets:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid target_field '{f.target_field}' for table '{payload.target_table}'"
            )

    # remove existing profile with same name+table if exists
    db.query(ImportFieldMapping).filter(
        ImportFieldMapping.mapping_name == payload.mapping_name,
        ImportFieldMapping.target_table == payload.target_table,
    ).delete()

    created = []
    for f in payload.fields:
        m = ImportFieldMapping(
            mapping_name  = payload.mapping_name,
            source_type   = payload.source_type,
            target_table  = payload.target_table,
            source_field  = f.source_field,
            target_field  = f.target_field,
            transform_rule = f.transform_rule,
            is_required   = f.is_required,
            default_value = f.default_value,
        )
        db.add(m)
        created.append(m)

    db.commit()
    for m in created:
        db.refresh(m)

    return {
        "mapping_name": payload.mapping_name,
        "source_type":  payload.source_type,
        "target_table": payload.target_table,
        "fields":       [_serialize(m) for m in created],
    }


@router.patch("/{mapping_id}")
def update_mapping_field(mapping_id: str, payload: MappingFieldUpdate, db: Session = Depends(get_db)):
    m = db.query(ImportFieldMapping).filter(ImportFieldMapping.mapping_id == mapping_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mapping not found")
    if payload.source_field   is not None: m.source_field   = payload.source_field
    if payload.target_field   is not None: m.target_field   = payload.target_field
    if payload.transform_rule is not None: m.transform_rule = payload.transform_rule
    if payload.is_required    is not None: m.is_required    = payload.is_required
    if payload.default_value  is not None: m.default_value  = payload.default_value
    db.commit()
    db.refresh(m)
    return _serialize(m)


@router.delete("/{mapping_id}")
def delete_mapping_field(mapping_id: str, db: Session = Depends(get_db)):
    m = db.query(ImportFieldMapping).filter(ImportFieldMapping.mapping_id == mapping_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mapping not found")
    db.delete(m)
    db.commit()
    return {"deleted": mapping_id}


@router.delete("/profile/{mapping_name}/{target_table}")
def delete_profile(mapping_name: str, target_table: str, db: Session = Depends(get_db)):
    deleted = db.query(ImportFieldMapping).filter(
        ImportFieldMapping.mapping_name == mapping_name,
        ImportFieldMapping.target_table == target_table,
    ).delete()
    if not deleted:
        raise HTTPException(status_code=404, detail="Profile not found")
    db.commit()
    return {"deleted_profile": mapping_name, "fields_removed": deleted}


@router.post("/validate")
async def validate_file(
    mapping_name:  str,
    target_table:  str,
    file:          UploadFile = File(...),
    db:            Session = Depends(get_db),
):
    mappings = db.query(ImportFieldMapping).filter(
        ImportFieldMapping.mapping_name == mapping_name,
        ImportFieldMapping.target_table == target_table,
    ).all()

    if not mappings:
        raise HTTPException(status_code=404, detail="Mapping profile not found")

    content  = await file.read()
    filename = file.filename or ""

    if filename.endswith(".csv"):
        import csv
        import io
        reader    = csv.DictReader(io.StringIO(content.decode("utf-8")))
        rows      = list(reader)
        headers   = reader.fieldnames or []
    else:
        raise HTTPException(status_code=400, detail="Only CSV supported in MVP. Excel support in post-MVP.")

    required_sources = [m.source_field for m in mappings if m.is_required]
    missing_required = [f for f in required_sources if f not in headers]

    errors   = []
    warnings = []

    if missing_required:
        for f in missing_required:
            errors.append(f"Required source field '{f}' not found in file headers")

    unmapped_headers = [h for h in headers if h not in [m.source_field for m in mappings]]
    for h in unmapped_headers:
        warnings.append(f"Header '{h}' has no mapping defined — will be ignored")

    sample_rows     = rows[:5]
    row_validations = []
    for i, row in enumerate(sample_rows):
        row_errors = []
        for m in mappings:
            val = row.get(m.source_field)
            if m.is_required and not val:
                row_errors.append(f"Row {i+1}: required field '{m.source_field}' is empty")
        row_validations.append({"row": i + 1, "errors": row_errors})

    return {
        "file":           filename,
        "mapping_name":   mapping_name,
        "target_table":   target_table,
        "total_rows":     len(rows),
        "headers_found":  headers,
        "errors":         errors,
        "warnings":       warnings,
        "sample_preview": row_validations,
        "valid":          len(errors) == 0,
    }


# --- Actual Import ---

def _parse_file(content: bytes, filename: str) -> tuple:
    """Parse CSV or Excel file into list of dicts + header list."""
    if filename.endswith(".csv"):
        import csv as csv_mod
        import io
        reader = csv_mod.DictReader(io.StringIO(content.decode("utf-8")))
        rows = list(reader)
        headers = reader.fieldnames or []
        return rows, headers
    elif filename.endswith(".xlsx"):
        import io
        try:
            import openpyxl
        except ImportError:
            raise HTTPException(status_code=500, detail="openpyxl not installed. Run: pip install openpyxl")
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True)
        ws = wb.active
        all_rows = list(ws.iter_rows(values_only=True))
        if len(all_rows) < 2:
            return [], []
        headers = [str(h).strip() for h in all_rows[0] if h is not None]
        rows = []
        for row in all_rows[1:]:
            d = {}
            for i, val in enumerate(row):
                if i < len(headers):
                    d[headers[i]] = val
            rows.append(d)
        return rows, headers
    else:
        raise HTTPException(status_code=400, detail="Unsupported file type. Use .csv or .xlsx")


def _apply_transform(value, rule: str):
    """Apply a transform rule to a field value."""
    if value is None or value == "":
        return value
    val_str = str(value).strip()
    if not rule:
        return val_str

    from datetime import datetime as dt

    if rule == "date_format:YYYYMMDD":
        return dt.strptime(val_str, "%Y%m%d").date().isoformat()
    elif rule == "date_format:DD/MM/YYYY":
        return dt.strptime(val_str, "%d/%m/%Y").date().isoformat()
    elif rule == "date_format:MM/DD/YYYY":
        return dt.strptime(val_str, "%m/%d/%Y").date().isoformat()
    elif rule == "divide_by_100":
        return str(float(val_str) / 100)
    elif rule == "multiply_by_100":
        return str(float(val_str) * 100)
    elif rule == "uppercase":
        return val_str.upper()
    elif rule == "strip_whitespace":
        return val_str.strip()
    elif rule == "boolean_yn":
        return "true" if val_str.upper() in ("Y", "YES") else "false"
    elif rule == "boolean_10":
        return "true" if val_str == "1" else "false"
    else:
        return val_str


def _resolve_customer_id(db: Session, customer_code: str) -> str:
    """Look up a customer_id from customer_code."""
    from models.tables import Customer
    cust = db.query(Customer).filter(Customer.customer_code == customer_code).first()
    if cust:
        return str(cust.customer_id)
    return None


def _resolve_invoice_id(db: Session, invoice_number: str) -> str:
    """Look up an invoice_id from invoice_number."""
    inv = db.query(Invoice).filter(Invoice.invoice_number == invoice_number).first()
    if inv:
        return str(inv.invoice_id)
    return None


@router.post("/import")
async def import_file(
    mapping_name:  str,
    target_table:  str,
    file:          UploadFile = File(...),
    db:            Session = Depends(get_db),
):
    from models.tables import Customer, Invoice, Payment
    from datetime import datetime as dt
    import uuid as uuid_mod

    MAX_CUSTOMERS = 1000
    MAX_INVOICES  = 100000

    mappings = db.query(ImportFieldMapping).filter(
        ImportFieldMapping.mapping_name == mapping_name,
        ImportFieldMapping.target_table == target_table,
    ).all()

    if not mappings:
        raise HTTPException(status_code=404, detail="Mapping profile not found")

    content  = await file.read()
    filename = file.filename or ""
    rows, headers = _parse_file(content, filename)

    if not rows:
        raise HTTPException(status_code=400, detail="File is empty or has no data rows")

    field_map = {}
    for m in mappings:
        field_map[m.source_field] = {
            "target":    m.target_field,
            "transform": m.transform_rule,
            "required":  m.is_required,
            "default":   m.default_value,
        }

    success_count         = 0
    error_count           = 0
    row_errors            = []
    affected_customer_ids = set()

    for row_idx, raw_row in enumerate(rows, start=1):
        mapped_row    = {}
        row_has_error = False

        for source_field, cfg in field_map.items():
            raw_val = raw_row.get(source_field)

            if (raw_val is None or str(raw_val).strip() == "") and cfg["default"]:
                raw_val = cfg["default"]

            if cfg["required"] and (raw_val is None or str(raw_val).strip() == ""):
                row_errors.append(f"Row {row_idx}: required field '{source_field}' is empty")
                row_has_error = True
                continue

            try:
                transformed = _apply_transform(raw_val, cfg["transform"])
            except Exception as e:
                row_errors.append(f"Row {row_idx}: transform error on '{source_field}': {e}")
                row_has_error = True
                continue

            mapped_row[cfg["target"]] = transformed

        if row_has_error:
            error_count += 1
            continue

        try:
            if target_table == "customers":
                current_count = db.query(Customer).count()
                if current_count >= MAX_CUSTOMERS:
                    raise HTTPException(
                        status_code=402,
                        detail=f"Free tier limit reached: {MAX_CUSTOMERS} customers. Upgrade to import more."
                    )
                existing = db.query(Customer).filter(
                    Customer.customer_code == mapped_row.get("customer_code")
                ).first()
                if existing:
                    for k, v in mapped_row.items():
                        if k != "customer_code" and v is not None:
                            setattr(existing, k, v)
                    affected_customer_ids.add(str(existing.customer_id))
                else:
                    new_id = str(uuid_mod.uuid4())
                    obj    = Customer(customer_id=new_id, **mapped_row)
                    db.add(obj)
                    affected_customer_ids.add(new_id)

            elif target_table == "invoices":
                current_count = db.query(Invoice).count()
                if current_count >= MAX_INVOICES:
                    raise HTTPException(
                        status_code=402,
                        detail=f"Free tier limit reached: {MAX_INVOICES} invoices. Upgrade to import more."
                    )
                cust_code = mapped_row.pop("customer_code", None)
                if cust_code:
                    cid = _resolve_customer_id(db, cust_code)
                    if not cid:
                        row_errors.append(f"Row {row_idx}: customer_code '{cust_code}' not found in database")
                        error_count += 1
                        continue
                    mapped_row["customer_id"] = cid
                    affected_customer_ids.add(cid)

                existing = db.query(Invoice).filter(
                    Invoice.invoice_number == mapped_row.get("invoice_number")
                ).first()
                if existing:
                    for k, v in mapped_row.items():
                        if k != "invoice_number" and v is not None:
                            setattr(existing, k, v)
                else:
                    obj = Invoice(invoice_id=str(uuid_mod.uuid4()), **mapped_row)
                    db.add(obj)

            elif target_table == "payments":
                inv_num = mapped_row.pop("invoice_number", None)
                if inv_num:
                    iid = _resolve_invoice_id(db, inv_num)
                    if not iid:
                        row_errors.append(f"Row {row_idx}: invoice_number '{inv_num}' not found in database")
                        error_count += 1
                        continue
                    mapped_row["invoice_id"] = iid

                cust_code = mapped_row.pop("customer_code", None)
                if cust_code:
                    cid = _resolve_customer_id(db, cust_code)
                    if not cid:
                        row_errors.append(f"Row {row_idx}: customer_code '{cust_code}' not found in database")
                        error_count += 1
                        continue
                    mapped_row["customer_id"] = cid
                    affected_customer_ids.add(cid)

                obj = Payment(payment_id=str(uuid_mod.uuid4()), **mapped_row)
                db.add(obj)

            success_count += 1

        except HTTPException:
            raise
        except Exception as e:
            row_errors.append(f"Row {row_idx}: DB insert error: {e}")
            error_count += 1

    # --- AR Reconciliation (Missing = Paid) ---
    reconciled_count = 0
    if target_table == "invoices" and success_count > 0:
        new_invoice_numbers = set()
        for row in rows:
            inv_num_src = next((m.source_field for m in mappings if m.target_field == "invoice_number"), None)
            if inv_num_src and raw_row.get(inv_num_src):
                new_invoice_numbers.add(str(raw_row.get(inv_num_src)))

        if new_invoice_numbers:
            missing_invoices = db.query(Invoice).filter(
                Invoice.status.in_(["open", "partial"]),
                ~Invoice.invoice_number.in_(list(new_invoice_numbers))
            ).all()

            for inv in missing_invoices:
                inv.status             = "paid"
                inv.outstanding_amount = 0
                inv.updated_at         = dt.utcnow()
                pay = Payment(
                    payment_id      = str(uuid_mod.uuid4()),
                    invoice_id      = inv.invoice_id,
                    customer_id     = inv.customer_id,
                    payment_date    = dt.utcnow().date(),
                    payment_amount  = inv.outstanding_amount,
                    payment_method  = "auto_reconciliation",
                    reference_number= f"RECON-{filename}"
                )
                db.add(pay)
                affected_customer_ids.add(str(inv.customer_id))
                reconciled_count += 1

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database commit failed: {e}")

    log = DataImportLog(
        import_type    = target_table,
        source         = filename,
        total_records  = len(rows),
        success_records= success_count,
        failed_records = error_count,
        error_detail   = {"errors": row_errors[:50]} if row_errors else None,
        imported_by    = "ui_upload",
    )
    db.add(log)
    db.commit()

    return {
        "status":                 "complete",
        "file":                   filename,
        "target_table":           target_table,
        "total_rows":             len(rows),
        "success":                success_count,
        "errors":                 error_count,
        "reconciled":             reconciled_count,
        "error_details":          row_errors[:20],
        "affected_customer_ids":  list(affected_customer_ids),
    }


@router.get("/import-log")
def get_import_log(
    limit: int = 20,
    db: Session = Depends(get_db),
):
    logs = db.query(DataImportLog).order_by(DataImportLog.imported_at.desc()).limit(limit).all()
    return [
        {
            "import_id": str(l.import_id),
            "import_type": l.import_type,
            "source": l.source,
            "total_records": l.total_records,
            "success_records": l.success_records,
            "failed_records": l.failed_records,
            "error_detail": l.error_detail,
            "imported_by": l.imported_by,
            "imported_at": l.imported_at.isoformat() if l.imported_at else None,
        }
        for l in logs
    ]
