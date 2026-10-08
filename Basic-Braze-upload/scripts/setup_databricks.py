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


def main():
    load_dotenv()
    catalog, schema = db.target()
    print(f"Target: {catalog}.{schema} on {os.environ['DATABRICKS_HOST']}")

    print("Creating schema…")
    db.execute(f"CREATE SCHEMA IF NOT EXISTS `{catalog}`.`{schema}` COMMENT 'Braze Test Shop'", catalog_schema=(catalog, None))

    print("Creating tables…")
    run_file("01_tables.sql")

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

    for table in ("categories", "subcategories", "products", "product_variants", "users", "orders", "order_items"):
        n = db.execute(f"SELECT COUNT(*) AS n FROM {table}")[0]["n"]
        print(f"  {table:<17} {n} rows")
    print("Done.")


if __name__ == "__main__":
    try:
        main()
    except db.DatabricksError as e:
        sys.exit(f"Databricks error: {e}")
