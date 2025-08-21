import { runLangExtract, ingestExtractions } from "../adapters/langextract";
import { InMemoryStore } from "../../memory/stores/memoryStore";

async function main() {
  console.log("Running langextract demo...");

  // 1. Set up a dummy memory store
  const store = new InMemoryStore();
  await store.init();

  // 2. Define the extraction job
  const prompt = "Extract entities, relations, events (with times), and steps. Use exact spans.";
  const doc = "On 2025-08-10, Alice signed the contract.";
  const examples = [
    {
      text: "On 2025-08-10, Alice signed the contract.",
      extractions: [
        { extraction_class: "entity", extraction_text: "Alice" },
        { extraction_class: "event", extraction_text: "signed the contract", attributes: { date: "2025-08-10" } }
      ]
    }
  ];

  // This would be a real URL in production. For the demo, we pass text directly.
  const text_or_url = doc;
  const currentTopic = "contract-signing";
  const currentRole = "planner";

  try {
    // 3. Run the extraction
    // NOTE: This requires the Python server.py to be running on localhost:8011
    console.log(`\n--- Calling langextract service ---`);
    console.log(`Text: "${text_or_url}"`);
    console.log(`Prompt: "${prompt}"`);

    const extractions = await runLangExtract("http://localhost:8011", {
      text_or_url,
      prompt_description: prompt,
      examples
    });

    console.log("\n--- Extractions received ---");
    console.log(JSON.stringify(extractions, null, 2));

    // 4. Ingest the extractions into memory
    await ingestExtractions(store, extractions, currentTopic, currentRole);

    // 5. Verify the contents of the memory store
    const searchResults = await store.search({ topic: currentTopic });
    console.log("\n--- Memory store contents after ingestion ---");
    console.log(JSON.stringify(searchResults, null, 2));

    if (searchResults.length > 0) {
      console.log("\n✅ Demo finished successfully.");
    } else {
      console.log("\n❌ Demo finished, but no items were added to the memory store.");
    }

  } catch (e) {
    console.error("\n❌ Demo failed:", e);
    console.error("Please ensure the Python server is running: `uvicorn server:app --port 8011`");
  }
}

main();
