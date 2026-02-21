from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
import sys

from sqlalchemy import insert, select

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.session import SessionLocal
from app.db.schema import accounts_user as users
from app.db.schema import catalog_category as categories
from app.db.schema import catalog_product as products
from app.db.schema import companies_company as companies
from app.db.schema import companies_companymember as members
from app.db.schema import delivery_deliveryassignment as deliveries
from app.db.schema import orders_order as orders
from app.db.schema import orders_orderitem as order_items
from app.utils.auth import make_legacy_password


NOW = datetime.now(timezone.utc)


def get_user_by_email(db, email: str):
    return db.execute(select(users).where(users.c.email == email)).mappings().first()


def ensure_user(db, *, email: str, password: str, first_name: str, last_name: str, phone: str) -> int:
    row = get_user_by_email(db, email)
    if row:
        return int(row["id"])
    values = {
        "email": email,
        "password": make_legacy_password(password),
        "first_name": first_name,
        "last_name": last_name,
        "phone": phone,
        "is_superuser": False,
        "is_active": True,
        "is_staff": False,
        "is_courier_enabled": False,
        "last_login": None,
        "created_at": NOW,
    }
    return int(db.execute(insert(users).values(values).returning(users.c.id)).scalar_one())


def ensure_company(db, *, name: str, company_type: str, phone: str, address: str) -> int:
    row = db.execute(
        select(companies).where(companies.c.name == name, companies.c.company_type == company_type)
    ).mappings().first()
    if row:
        return int(row["id"])
    values = {
        "name": name,
        "company_type": company_type,
        "phone": phone,
        "address": address,
        "created_at": NOW,
    }
    return int(db.execute(insert(companies).values(values).returning(companies.c.id)).scalar_one())


def ensure_membership(db, *, user_id: int, company_id: int, role: str = "OWNER") -> None:
    exists = db.execute(
        select(members.c.id).where(members.c.user_id == user_id, members.c.company_id == company_id)
    ).first()
    if exists:
        return
    db.execute(
        insert(members).values(
            user_id=user_id,
            company_id=company_id,
            role=role,
            created_at=NOW,
        )
    )


def ensure_category(db, name: str) -> int:
    row = db.execute(select(categories).where(categories.c.name == name)).mappings().first()
    if row:
        return int(row["id"])
    return int(db.execute(insert(categories).values(name=name).returning(categories.c.id)).scalar_one())


def ensure_product(
    db,
    *,
    supplier_company_id: int,
    category_id: int,
    name: str,
    price: Decimal,
    unit: str = "kg",
    min_qty: Decimal = Decimal("1"),
    in_stock: bool = True,
    stock_qty: Decimal = Decimal("100"),
) -> int:
    row = db.execute(
        select(products).where(
            products.c.supplier_company_id == supplier_company_id,
            products.c.name == name,
        )
    ).mappings().first()
    if row:
        return int(row["id"])
    values = {
        "supplier_company_id": supplier_company_id,
        "category_id": category_id,
        "name": name,
        "description": f"{name} wholesale",
        "price": price,
        "unit": unit,
        "min_qty": min_qty,
        "in_stock": in_stock,
        "created_at": NOW,
        "track_inventory": True,
        "stock_qty": stock_qty,
    }
    return int(db.execute(insert(products).values(values).returning(products.c.id)).scalar_one())


def get_product_price(db, product_id: int) -> Decimal:
    row = db.execute(select(products.c.price).where(products.c.id == product_id)).first()
    if not row:
        return Decimal("0")
    return Decimal(row[0] or 0)


def ensure_order(
    db,
    *,
    buyer_company_id: int,
    supplier_company_id: int,
    status: str,
    created_at: datetime,
    delivery_mode: str,
    comment: str,
    item_rows: list[tuple[int, Decimal]],
) -> int:
    existing = db.execute(select(orders).where(orders.c.comment == comment)).mappings().first()
    if existing:
        return int(existing["id"])

    order_id = int(
        db.execute(
            insert(orders)
            .values(
                status=status,
                delivery_mode=delivery_mode,
                comment=comment,
                created_at=created_at,
                buyer_company_id=buyer_company_id,
                supplier_company_id=supplier_company_id,
            )
            .returning(orders.c.id)
        ).scalar_one()
    )

    for product_id, qty in item_rows:
        price = get_product_price(db, product_id)
        db.execute(
            insert(order_items).values(
                qty=qty,
                price_snapshot=price,
                order_id=order_id,
                product_id=product_id,
            )
        )

    return order_id


def ensure_delivery(db, *, order_id: int, status: str, notes: str) -> None:
    existing = db.execute(select(deliveries).where(deliveries.c.order_id == order_id)).mappings().first()
    if existing:
        return
    db.execute(
        insert(deliveries).values(
            status=status,
            tracking_link=f"https://track.usc.local/order/{order_id}",
            notes=notes,
            created_at=NOW,
            courier_id=None,
            order_id=order_id,
        )
    )


def main() -> None:
    db = SessionLocal()
    try:
        # Users
        buyer_1 = ensure_user(
            db,
            email="buyer1@usc.demo",
            password="demo123456",
            first_name="Aibek",
            last_name="Buyer",
            phone="+996700000001",
        )
        buyer_2 = ensure_user(
            db,
            email="buyer2@usc.demo",
            password="demo123456",
            first_name="Nura",
            last_name="Buyer",
            phone="+996700000002",
        )
        supplier_1 = ensure_user(
            db,
            email="supplier1@usc.demo",
            password="demo123456",
            first_name="Bek",
            last_name="Supplier",
            phone="+996700000101",
        )
        supplier_2 = ensure_user(
            db,
            email="supplier2@usc.demo",
            password="demo123456",
            first_name="Dana",
            last_name="Supplier",
            phone="+996700000102",
        )
        supplier_3 = ensure_user(
            db,
            email="supplier3@usc.demo",
            password="demo123456",
            first_name="Arsen",
            last_name="Supplier",
            phone="+996700000103",
        )
        supplier_4 = ensure_user(
            db,
            email="supplier4@usc.demo",
            password="demo123456",
            first_name="Mira",
            last_name="Supplier",
            phone="+996700000104",
        )

        # Companies
        buyer_co_1 = ensure_company(
            db,
            name="Bishkek Cafe Group",
            company_type="BUYER",
            phone="+996312100001",
            address="Bishkek, Chui Ave 10",
        )
        buyer_co_2 = ensure_company(
            db,
            name="Nomad Market LLC",
            company_type="BUYER",
            phone="+996312100002",
            address="Bishkek, Kievskaya 55",
        )
        supplier_co_1 = ensure_company(
            db,
            name="FreshFarm Supply",
            company_type="SUPPLIER",
            phone="+996312200001",
            address="Kant, Industrial 2",
        )
        supplier_co_2 = ensure_company(
            db,
            name="OceanLine Trade",
            company_type="SUPPLIER",
            phone="+996312200002",
            address="Bishkek, Logistika 8",
        )
        supplier_co_3 = ensure_company(
            db,
            name="Green Valley Agro",
            company_type="SUPPLIER",
            phone="+996312200003",
            address="Sokuluk, Farm line 12",
        )
        supplier_co_4 = ensure_company(
            db,
            name="NorthPeak Foods",
            company_type="SUPPLIER",
            phone="+996312200004",
            address="Bishkek, East warehouse 3",
        )

        ensure_membership(db, user_id=buyer_1, company_id=buyer_co_1)
        ensure_membership(db, user_id=buyer_2, company_id=buyer_co_2)
        ensure_membership(db, user_id=supplier_1, company_id=supplier_co_1)
        ensure_membership(db, user_id=supplier_2, company_id=supplier_co_2)
        ensure_membership(db, user_id=supplier_3, company_id=supplier_co_3)
        ensure_membership(db, user_id=supplier_4, company_id=supplier_co_4)

        # Categories
        cat_meat = ensure_category(db, "Meat")
        cat_milk = ensure_category(db, "Milk")
        cat_fish = ensure_category(db, "Fish")
        cat_bread = ensure_category(db, "Bread")
        cat_fruit = ensure_category(db, "Fruit")
        cat_grain = ensure_category(db, "Grain")

        # Products
        p1 = ensure_product(db, supplier_company_id=supplier_co_1, category_id=cat_meat, name="Beef Premium", price=Decimal("780"))
        p2 = ensure_product(db, supplier_company_id=supplier_co_1, category_id=cat_milk, name="Milk 3.2%", price=Decimal("68"), unit="l")
        p3 = ensure_product(db, supplier_company_id=supplier_co_1, category_id=cat_bread, name="Wheat Bread", price=Decimal("30"), unit="pcs")
        p4 = ensure_product(db, supplier_company_id=supplier_co_1, category_id=cat_fruit, name="Tomatoes", price=Decimal("95"))
        p5 = ensure_product(db, supplier_company_id=supplier_co_2, category_id=cat_fish, name="Salmon Fillet", price=Decimal("1200"))
        p6 = ensure_product(db, supplier_company_id=supplier_co_2, category_id=cat_fish, name="Trout Fresh", price=Decimal("920"))
        p7 = ensure_product(db, supplier_company_id=supplier_co_2, category_id=cat_grain, name="Rice Long Grain", price=Decimal("75"))
        p8 = ensure_product(db, supplier_company_id=supplier_co_2, category_id=cat_grain, name="Buckwheat", price=Decimal("88"))
        p9 = ensure_product(db, supplier_company_id=supplier_co_3, category_id=cat_fruit, name="Apples Gala", price=Decimal("92"))
        p10 = ensure_product(db, supplier_company_id=supplier_co_3, category_id=cat_fruit, name="Bananas Premium", price=Decimal("118"))
        p11 = ensure_product(db, supplier_company_id=supplier_co_3, category_id=cat_milk, name="Yogurt Natural", price=Decimal("84"), unit="pcs")
        p12 = ensure_product(db, supplier_company_id=supplier_co_3, category_id=cat_bread, name="Corn Bread", price=Decimal("42"), unit="pcs")
        p13 = ensure_product(db, supplier_company_id=supplier_co_4, category_id=cat_meat, name="Chicken Fillet", price=Decimal("420"))
        p14 = ensure_product(db, supplier_company_id=supplier_co_4, category_id=cat_meat, name="Turkey Breast", price=Decimal("610"))
        p15 = ensure_product(db, supplier_company_id=supplier_co_4, category_id=cat_grain, name="Oat Flakes", price=Decimal("96"))
        p16 = ensure_product(db, supplier_company_id=supplier_co_4, category_id=cat_fish, name="Mackerel", price=Decimal("540"))

        # Orders: dense monthly dataset for rich analytics (12 months x many orders)
        catalog = {
            "freshfarm": [p1, p2, p3, p4],
            "oceanline": [p5, p6, p7, p8],
        }
        pairs = [
            (buyer_co_1, supplier_co_1, "freshfarm"),
            (buyer_co_2, supplier_co_1, "freshfarm"),
            (buyer_co_1, supplier_co_2, "oceanline"),
            (buyer_co_2, supplier_co_2, "oceanline"),
        ]
        month_volume = [18, 20, 19, 21, 23, 24, 26, 27, 29, 31, 33, 36]

        created_count = 0
        for month_idx in range(12):
            month_base = NOW - timedelta(days=(11 - month_idx) * 30)
            volume = month_volume[month_idx]
            for i in range(volume):
                buyer_id, supplier_id, key = pairs[(i + month_idx) % len(pairs)]
                products_pack = catalog[key]
                p_a = products_pack[(i + month_idx) % len(products_pack)]
                p_b = products_pack[(i + month_idx + 1) % len(products_pack)]
                q_a = Decimal(str(6 + ((i * 3 + month_idx) % 17)))
                q_b = Decimal(str(5 + ((i * 5 + month_idx) % 15)))

                # mostly delivered, with a realistic tail of in-progress/cancelled
                if i < volume - 4:
                    status = "DELIVERED"
                elif i == volume - 4:
                    status = "CONFIRMED"
                elif i == volume - 3:
                    status = "DELIVERING"
                elif i == volume - 2:
                    status = "PENDING"
                else:
                    status = "CANCELLED"

                mode = ["SUPPLIER_COURIER", "BUYER_COURIER", "YANDEX"][(i + month_idx) % 3]
                created_at = month_base + timedelta(days=(i % 27), hours=(i * 2) % 24, minutes=(i * 7) % 60)
                comment = f"DEMO-M{month_idx + 1:02d}-O{i + 1:03d}"

                oid = ensure_order(
                    db,
                    buyer_company_id=buyer_id,
                    supplier_company_id=supplier_id,
                    status=status,
                    created_at=created_at,
                    delivery_mode=mode,
                    comment=comment,
                    item_rows=[(p_a, q_a), (p_b, q_b)],
                )

                delivery_status = "ASSIGNED"
                if status == "DELIVERED":
                    delivery_status = "DELIVERED"
                elif status == "DELIVERING":
                    delivery_status = "ON_THE_WAY"
                elif status == "CONFIRMED":
                    delivery_status = "PICKED_UP"
                elif status == "CANCELLED":
                    delivery_status = "FAILED"

                ensure_delivery(db, order_id=oid, status=delivery_status, notes=f"Demo delivery for {comment}")
                created_count += 1

        # New suppliers only: separate stream with stronger monthly dynamics.
        # Existing suppliers/orders above stay untouched.
        catalog_new = {
            "greenvalley": [p9, p10, p11, p12],
            "northpeak": [p13, p14, p15, p16],
        }
        # 2000 new orders across 12 months from NEW suppliers only.
        month_volume_new = [100, 116, 124, 140, 148, 158, 168, 180, 190, 210, 224, 242]

        for month_idx in range(12):
            month_base = NOW - timedelta(days=(11 - month_idx) * 30)
            volume = month_volume_new[month_idx]
            buyer1_share = 0.65
            buyer1_volume = int(volume * buyer1_share)
            for i in range(volume):
                buyer_id = buyer_co_1 if i < buyer1_volume else buyer_co_2
                supplier_slot = (i + month_idx) % 2
                if supplier_slot == 0:
                    supplier_id, key = supplier_co_3, "greenvalley"
                else:
                    supplier_id, key = supplier_co_4, "northpeak"
                products_pack = catalog_new[key]
                p_a = products_pack[(i + month_idx) % len(products_pack)]
                p_b = products_pack[(i + month_idx + 2) % len(products_pack)]
                q_a = Decimal(str(8 + ((i * 4 + month_idx) % 20)))
                q_b = Decimal(str(5 + ((i * 6 + month_idx) % 18)))

                if i < volume - 3:
                    status = "DELIVERED"
                elif i == volume - 3:
                    status = "DELIVERING"
                elif i == volume - 2:
                    status = "CONFIRMED"
                else:
                    status = "PENDING"

                mode = ["SUPPLIER_COURIER", "BUYER_COURIER", "YANDEX"][(i + month_idx + 1) % 3]
                created_at = month_base + timedelta(days=(i % 26), hours=(i * 3) % 24, minutes=(i * 11) % 60)
                comment = f"DEMO-NEW-M{month_idx + 1:02d}-O{i + 1:03d}"

                oid = ensure_order(
                    db,
                    buyer_company_id=buyer_id,
                    supplier_company_id=supplier_id,
                    status=status,
                    created_at=created_at,
                    delivery_mode=mode,
                    comment=comment,
                    item_rows=[(p_a, q_a), (p_b, q_b)],
                )

                delivery_status = "ASSIGNED"
                if status == "DELIVERED":
                    delivery_status = "DELIVERED"
                elif status == "DELIVERING":
                    delivery_status = "ON_THE_WAY"
                elif status == "CONFIRMED":
                    delivery_status = "PICKED_UP"

                ensure_delivery(db, order_id=oid, status=delivery_status, notes=f"Demo delivery for {comment}")
                created_count += 1

        db.commit()

        print("Demo data seeded successfully.")
        print(f"Orders generated/verified in this run: {created_count}")
        print("Accounts:")
        print("  buyer1@usc.demo / demo123456")
        print("  buyer2@usc.demo / demo123456")
        print("  supplier1@usc.demo / demo123456")
        print("  supplier2@usc.demo / demo123456")
        print("  supplier3@usc.demo / demo123456")
        print("  supplier4@usc.demo / demo123456")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
