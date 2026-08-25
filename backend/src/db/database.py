from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os

SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+pg8000://postgres:password@localhost:5433/worker_monitor")

if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
else:
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        pool_size=10,           # baseline connections kept open
        max_overflow=20,        # burst capacity above pool_size
        pool_pre_ping=True,     # detect stale connections before use
        pool_recycle=300,       # recycle connections every 5 min (avoids PG timeout kills)
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
