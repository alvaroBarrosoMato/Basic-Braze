"""Create the schema + Delta tables in Databricks and load the initial catalogue.

Usage (from the project root, with a .env file — see .env.example):
    python3 scripts/setup_databricks.py              # create tables, seed catalogue if empty
    python3 scripts/setup_databricks.py --reseed     # wipe catalogue tables and load the seed again

Safe to re-run: tables use CREATE TABLE IF NOT EXISTS and users/orders are never touched.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "api"))
import _databricks as db  # noqa: E402


def load_dotenv(path=os.path.join(ROOT, ".env")):
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def statements(path):
    """Split a .sql file into statements (one per API call)."""
    sql = "\n".join(l for l in open(path, encoding="utf-8") if not l.lstrip().startswith("--"))
    return [s.strip().rstrip(";") for s in re.split(r";\s*\n", sql) if s.strip()]


def run_file(name):
    for stmt in statements(os.path.join(ROOT, "sql", name)):
        first_line = stmt.splitlines()[0][:80]
        print(f"  {first_line}")
        db.execute(stmt)


# Columns added after the first release. CREATE TABLE IF NOT EXISTS doesn't touch
# existing tables, so add them here for workspaces created with an older version.
NEW_COLUMNS = {
    "users": {"zip_code": "STRING", "updated_at": "TIMESTAMP"},
}


def add_missing_columns():
    for table, columns in NEW_COLUMNS.items():
        existing = {r["column_name"] for r in db.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = :schema AND table_name = :table",
            {"schema": db.target()[1], "table": table})}
        missing = {c: t for c, t in columns.items() if c not in existing}
        if missing:
            print(f"  ALTER TABLE {table} ADD COLUMNS {', '.join(missing)}")
            db.execute(f"ALTER TABLE {table} ADD COLUMNS ({', '.join(f'{c} {t}' for c, t in missing.items())})")


def main():
    load_dotenv()
    catalog, schema = db.target()
    print(f"Target: {catalog}.{schema} on {os.environ['DATABRICKS_HOST']}")

    print("Creating schema…")
    db.execute(f"CREATE SCHEMA IF NOT EXISTS `{catalog}`.`{schema}` COMMENT 'Braze Test Shop'", catalog_schema=(catalog, None))

    print("Creating tables…")
    run_file("01_tables.sql")
    add_missing_columns()

    if "--reseed" in sys.argv:
        print("Wiping catalogue tables…")
        for table in ("product_variants", "products", "subcategories", "categories"):
            db.execute(f"DELETE FROM {table}")

    count = int(db.execute("SELECT COUNT(*) AS n FROM products")[0]["n"])
    if count == 0:
        print("Loading catalogue…")
        run_file("02_seed_catalog.sql")
    else:
        print(f"Catalogue already has {count} products — skipping seed (use --reseed to reload).")

    print("Adding table comments…")
    run_file("03_comments.sql")

    print("Creating Braze Catalog view…")
    run_file("04_braze_catalog_view.sql")

    for table in ("categories", "subcategories", "products", "product_variants", "users", "orders", "order_items"):
        n = db.execute(f"SELECT COUNT(*) AS n FROM {table}")[0]["n"]
        print(f"  {table:<17} {n} rows")
    print("Done.")


if __name__ == "__main__":
    try:
        main()
    except db.DatabricksError as e:
        sys.exit(f"Databricks error: {e}")
