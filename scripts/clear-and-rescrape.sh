#!/bin/bash

echo "Clearing old data and re-scraping..."

# Clear all collections from Firestore using Firebase CLI
echo "Deleting the following collections: events, flights, interactions, profiles, status, tagProposals, tags"
firebase firestore:delete / --all-collections --force --project community-api

echo "Waiting for deletion to complete..."
sleep 3

echo "Triggering community events sync..."
curl "https://us-central1-community-api-ba17c.cloudfunctions.net/triggerCommunityEventsSync?forceRefresh=true"

echo ""
echo "Re-scraping complete!"
echo ""
echo "Test the API with:"
echo "curl -H 'X-API-Key: 05413fbc45028b7295bbc6cffbdc506829b3c3457039c06dbc2ff6f54ea79348' \\"
echo "  'https://us-central1-community-api-ba17c.cloudfunctions.net/api/feed?start=2025-09-29&days=7' | python3 -m json.tool"