import pytest
import pytest_asyncio
import asyncio
from httpx import AsyncClient, ASGITransport
from asgi_lifespan import LifespanManager
from uuid import uuid4
import os

# Set environment variables for the test run
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test.db" # Use a separate test database

from server import app
from src.database import database, models

@pytest_asyncio.fixture(scope="module")
async def client():
    """
    Create an async client that handles lifespan events for the API tests.
    """
    transport = ASGITransport(app=app)
    async with LifespanManager(app) as manager:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c

    # Cleanup the test database and index files after tests are done
    if os.path.exists("test.db"):
        os.remove("test.db")
    if os.path.exists("faiss_index.bin"):
        os.remove("faiss_index.bin")
    if os.path.exists("id_mapping.json"):
        os.remove("id_mapping.json")


@pytest.mark.asyncio
async def test_notes_crud_flow(client: AsyncClient):
    """
    Tests the full CRUD (Create, Read, Update, Delete) flow for notes.
    """
    # 1. Create a note
    create_payload = {"title": "Test Note", "content": "This is a test for CRUD operations."}
    response = await client.post("/api/notes/", json=create_payload)
    assert response.status_code == 201, response.text
    note_data = response.json()
    note_id = note_data["id"]
    assert note_data["title"] == "Test Note"

    # Allow some time for background embedding to complete.
    # In a real test suite, we might poll or use a more deterministic way to wait.
    await asyncio.sleep(2)

    # 2. Read the note
    response = await client.get(f"/api/notes/{note_id}")
    assert response.status_code == 200, response.text
    read_data = response.json()
    assert read_data["title"] == "Test Note"
    assert len(read_data["chunks"]) > 0, "Chunks should have been created automatically"

    # 3. Update the note
    update_payload = {"title": "Updated Test Note", "content": "The content has been updated."}
    response = await client.put(f"/api/notes/{note_id}", json=update_payload)
    assert response.status_code == 200, response.text
    updated_data = response.json()
    assert updated_data["title"] == "Updated Test Note"

    # 4. Delete the note
    response = await client.delete(f"/api/notes/{note_id}")
    assert response.status_code == 200, response.text

    # 5. Verify deletion
    response = await client.get(f"/api/notes/{note_id}")
    assert response.status_code == 404, "Note should not be found after deletion"

@pytest.mark.asyncio
async def test_vector_search(client: AsyncClient):
    """
    Tests the vector search functionality by creating two notes and searching for one from the other.
    """
    # 1. Create two distinct notes
    note1_payload = {"title": "Technology", "content": "Artificial intelligence is transforming the world."}
    note2_payload = {"title": "History", "content": "The Roman Empire was vast and influential."}

    note1_res = await client.post("/api/notes/", json=note1_payload)
    note2_res = await client.post("/api/notes/", json=note2_payload)
    assert note1_res.status_code == 201
    assert note2_res.status_code == 201
    note1_id = note1_res.json()["id"]
    note2_id = note2_res.json()["id"]

    # Allow time for embedding to be processed and indexed
    await asyncio.sleep(3)

    # 2. Search for chunks similar to note 1
    search_payload = {"note_id": note1_id, "k": 5}
    response = await client.post("/api/search/similar_chunks", json=search_payload)
    assert response.status_code == 200, response.text
    search_results = response.json()

    # 3. Verify that the results are not empty
    assert len(search_results) > 0, "Search should return some results"

    # Optional: A more robust test could fetch the chunks and verify they don't belong to note1

    # Cleanup
    await client.delete(f"/api/notes/{note1_id}")
    await client.delete(f"/api/notes/{note2_id}")
