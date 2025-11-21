"""
Concepts API: Exposes concept categories from MongoDB

Provides public endpoint for frontend to query available categories dynamically.
Categories are loaded from MongoDB 'concepts' collection and cached.
"""

from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any
from pymongo.database import Database

from app.core.database import get_database
from app.services.category_service import CategoryService

router = APIRouter(prefix="/concepts", tags=["concepts"])


@router.get("/{entity_type}")
def get_concepts(
    entity_type: str,
    db: Database = Depends(get_database)
) -> Dict[str, Any]:
    """
    Get concept categories for entity type.
    
    Args:
        entity_type: Type of entity (restaurant, hotel, bar, cafe, venue, etc.)
        
    Returns:
        {
            "entity_type": "restaurant",
            "categories": ["cuisine", "menu", "food_style", ...],
            "description": "Concept categories for restaurant entities",
            "version": 2,
            "active": true
        }
        
    Notes:
        - Categories are loaded from MongoDB 'concepts' collection
        - Results are cached for 1 hour
        - Falls back to 'restaurant' categories if entity_type not found
    """
    category_service = CategoryService(db)
    
    # Get the full document from MongoDB
    doc = db.concepts.find_one({
        "entity_type": entity_type,
        "active": True
    })
    
    if not doc:
        # Fallback to restaurant
        if entity_type != "restaurant":
            doc = db.concepts.find_one({
                "entity_type": "restaurant",
                "active": True
            })
        
        if not doc:
            raise HTTPException(
                status_code=404,
                detail=f"No active concepts found for entity_type '{entity_type}'"
            )
    
    # Convert MongoDB _id to string
    if "_id" in doc:
        doc["_id"] = str(doc["_id"])
    
    return doc


@router.get("/")
def list_concepts(
    db: Database = Depends(get_database)
) -> Dict[str, Any]:
    """
    List all available concept configurations.
    
    Returns:
        {
            "concepts": [
                {
                    "entity_type": "restaurant",
                    "categories": ["cuisine", "menu", ...],
                    "version": 2,
                    "active": true
                },
                ...
            ],
            "count": 1
        }
    """
    cursor = db.concepts.find({"active": True})
    concepts = []
    
    for doc in cursor:
        # Convert MongoDB _id to string
        if "_id" in doc:
            doc["_id"] = str(doc["_id"])
        concepts.append(doc)
    
    return {
        "concepts": concepts,
        "count": len(concepts)
    }
