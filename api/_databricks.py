"""Minimal Databricks SQL client over the SQL Statement Execution API.

Standard library only (no pip install needed on Vercel).
Docs: https://docs.databricks.com/api/workspace/statementexecution

Environment variables:
  DATABRICKS_HOST           e.g. dbc-1234abcd-5678.cloud.databricks.com
  DATABRICKS_WAREHOUSE_ID   SQL warehouse ID (SQL Warehouses > your warehouse > Connection details)
  DATABRICKS_CATALOG        e.g. workspace
  DATABRICKS_SCHEMA         e.g. braze_shop
  Auth, one of:
    DATABRICKS_TOKEN                                   personal access token
    DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET    service principal (OAuth M2M, recommended)
"""
import base64
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime
from decimal import Decimal

TIMEOUT_S = 50  # total time we wait for a statement (serverless warehouses may need a few s to wake up)


class DatabricksError(Exception):
    pass


def _env(name, required=True):
    value = (os.environ.get(name) or "").strip()
    if required and not value:
        raise DatabricksError(f"Missing environment variable {name}")
    return value


def _host():
    host = _env("DATABRICKS_HOST").rstrip("/")
    return host if host.startswith("http") else f"https://{host}"


def target():
    """(catalog, schema) the statements run against."""
    catalog, schema = _env("DATABRICKS_CATALOG"), _env("DATABRICKS_SCHEMA")
    for ident in (catalog, schema):
        if not re.fullmatch(r"[A-Za-z0-9_]+", ident):
            raise DatabricksError(f"Invalid catalog/schema name: {ident!r}")
    return catalog, schema


# ---------- Auth ----------
_oauth = {"token": None, "expires_at": 0}
_oauth_lock = threading.Lock()  # parallel queries share one token request


def _auth_header():
    token = _env("DATABRICKS_TOKEN", required=False)
    if token:
        return f"Bearer {token}"

    client_id = _env("DATABRICKS_CLIENT_ID", required=False)
    secret = _env("DATABRICKS_CLIENT_SECRET", required=False)
    if not (client_id and secret):
        raise DatabricksError("Set DATABRICKS_TOKEN, or DATABRICKS_CLIENT_ID and DATABRICKS_CLIENT_SECRET")

    with _oauth_lock:
        if not (_oauth["token"] and time.time() < _oauth["expires_at"] - 60):
            _refresh_oauth(client_id, secret)
        return f"Bearer {_oauth['token']}"


def _refresh_oauth(client_id, secret):
    basic = base64.b64encode(f"{client_id}:{secret}".encode()).decode()
    req = urllib.request.Request(
        f"{_host()}/oidc/v1/token",
        data=urllib.parse.urlencode({"grant_type": "client_credentials", "scope": "all-apis"}).encode(),
        headers={"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"},
    )
    body = _send(req)
    _oauth.update(token=body["access_token"], expires_at=time.time() + int(body.get("expires_in", 3600)))


# ---------- HTTP ----------
def _send(req):
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S + 10) as res:
            return json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        raise DatabricksError(f"Databricks HTTP {e.code}: {detail}") from None
    except urllib.error.URLError as e:
        raise DatabricksError(f"Cannot reach Databricks: {e.reason}") from None


def _api(method, path, payload=None):
    req = urllib.request.Request(
        f"{_host()}{path}",
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Authorization": _auth_header(), "Content-Type": "application/json"},
    )
    return _send(req)


# ---------- Statements ----------
def _param(name, value):
    """Python value -> typed named parameter (:name in the SQL)."""
    if value is None:
        return {"name": name, "type": "STRING"}  # no "value" = NULL
    if isinstance(value, bool):
        return {"name": name, "value": "true" if value else "false", "type": "BOOLEAN"}
    if isinstance(value, int):
        return {"name": name, "value": str(value), "type": "BIGINT"}
    if isinstance(value, Decimal):
        return {"name": name, "value": str(value), "type": "DECIMAL(18,2)"}
    if isinstance(value, float):
        return {"name": name, "value": repr(value), "type": "DOUBLE"}
    if isinstance(value, datetime):
        return {"name": name, "value": value.strftime("%Y-%m-%d %H:%M:%S"), "type": "TIMESTAMP"}
    if isinstance(value, date):
        return {"name": name, "value": value.isoformat(), "type": "DATE"}
    return {"name": name, "value": str(value), "type": "STRING"}


def execute(sql, params=None, catalog_schema=None):
    """Run one SQL statement. Returns a list of dicts; all values are strings (or None),
    exactly as the API returns them in JSON_ARRAY format."""
    catalog, schema = catalog_schema or target()
    payload = {
        "warehouse_id": _env("DATABRICKS_WAREHOUSE_ID"),
        "statement": sql,
        "parameters": [_param(k, v) for k, v in (params or {}).items()],
        **({"catalog": catalog} if catalog else {}),
        **({"schema": schema} if schema else {}),
        "disposition": "INLINE",
        "format": "JSON_ARRAY",
        "wait_timeout": "30s",
        "on_wait_timeout": "CONTINUE",
    }
    res = _api("POST", "/api/2.0/sql/statements/", payload)

    # Poll if the warehouse is still starting / the statement is still running
    deadline = time.time() + TIMEOUT_S
    while res.get("status", {}).get("state") in ("PENDING", "RUNNING"):
        if time.time() > deadline:
            _api("POST", f"/api/2.0/sql/statements/{res['statement_id']}/cancel")
            raise DatabricksError("Statement timed out (is the SQL warehouse running?)")
        time.sleep(1)
        res = _api("GET", f"/api/2.0/sql/statements/{res['statement_id']}")

    status = res.get("status", {})
    if status.get("state") != "SUCCEEDED":
        err = status.get("error", {})
        raise DatabricksError(f"{status.get('state')}: {err.get('message', 'unknown error')}")

    columns = [c["name"] for c in res.get("manifest", {}).get("schema", {}).get("columns", [])]
    result = res.get("result") or {}
    rows = list(result.get("data_array") or [])
    # Larger results come in chunks
    while result.get("next_chunk_internal_link"):
        result = _api("GET", result["next_chunk_internal_link"])
        rows.extend(result.get("data_array") or [])
    return [dict(zip(columns, row)) for row in rows]
