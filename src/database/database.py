import os
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./synapse.db")

engine = create_async_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
SessionLocal = async_sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

async def get_db():
    async with SessionLocal() as session:
        yield session
