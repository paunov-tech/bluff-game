// scripts/clear-duel-cache.mjs — one-shot Firestore cache wipe
// Deletes all docs in bluff_cache and bluff_rounds_blitz so the next
// pre-generate run populates fresh content with new subtopics.
//
// Usage:
//   export FIREBASE_API_KEY="$(grep FIREBASE_API_KEY .env.local | cut -d= -f2- | tr -d '\"')"
//   node scripts/clear-duel-cache.mjs

const FB_KEY = process.env.FIREBASE_API_KEY;
const FB_PROJECT = "molty-portal";
const COLLECTIONS = ["bluff_cache", "bluff_rounds_blitz"];

if (!FB_KEY) {
  console.error("FIREBASE_API_KEY not set");
  process.exit(1);
}

for (const coll of COLLECTIONS) {
  console.log(`\nClearing ${coll}...`);
  const url = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/${coll}?key=${FB_KEY}&pageSize=500`;
  const res = await fetch(url);
  const data = await res.json();
  const docs = data.documents || [];
  console.log(`  ${docs.length} docs to delete`);

  let deleted = 0;
  for (const doc of docs) {
    const delUrl = `https://firestore.googleapis.com/v1/${doc.name}?key=${FB_KEY}`;
    const r = await fetch(delUrl, { method: "DELETE" });
    if (r.ok) deleted++;
    else console.log(`  failed: ${doc.name}`);
  }
  console.log(`  ${deleted}/${docs.length} deleted`);
}
