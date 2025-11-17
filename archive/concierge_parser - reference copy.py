import re
import json
import pandas as pd
from datetime import datetime
import ast
from flask import Flask, render_template, jsonify, request

# No need for duplicate Flask instance - moved to central location
# app = Flask(__name__, static_folder="static", template_folder="templates")

import plotly.express as px
import plotly.graph_objects as go
import networkx as nx
from collections import defaultdict
import logging

# Setup logging more appropriately for PythonAnywhere
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

import traceback
from flask_cors import CORS

# Load environment variables, but use os.environ.get for more reliability
from dotenv import load_dotenv
import os
import io
import sys
import psycopg2  # Added for PostgreSQL database connectivity

# Get the correct paths for PythonAnywhere
PYTHONANYWHERE = 'PYTHONANYWHERE_DOMAIN' in os.environ
if PYTHONANYWHERE:
    # When running on PythonAnywhere, use these paths
    BASE_DIR = '/home/wsmontes/Concierge-Analyzer'
else:
    # When running locally, use these paths
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# carrega variáveis de ambiente
load_dotenv(os.path.join(BASE_DIR, '.env'))
FLASK_SERVER_URL = os.environ.get('FLASK_SERVER_URL', 'https://wsmontes.pythonanywhere.com' if PYTHONANYWHERE else 'http://localhost:5000')

# Initialize the Flask application ONCE
app = Flask(__name__, static_folder="static", template_folder="templates")
app.logger.setLevel(logging.INFO)

# Configure CORS properly
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max upload

# Database connection helper function
def get_db_connection():
    """
    Create and return a database connection with proper error handling.
    """
    try:
        conn = psycopg2.connect(
            host=os.environ.get("DB_HOST"),
            database=os.environ.get("DB_NAME"),
            user=os.environ.get("DB_USER"),
            password=os.environ.get("DB_PASSWORD"),
            connect_timeout=10  # 10 second timeout
        )
        return conn
    except psycopg2.Error as e:
        app.logger.error(f"Database connection error: {str(e)}")
        raise
    except Exception as e:
        app.logger.error(f"Unexpected database error: {str(e)}")
        raise

# Database health check endpoint
@app.route('/api/health', methods=['GET'])
def health_check():
    """
    Health check endpoint to verify database connectivity.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        cursor.close()
        conn.close()
        
        return jsonify({
            'status': 'healthy',
            'database': 'connected',
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        app.logger.error(f"Health check failed: {str(e)}")
        return jsonify({
            'status': 'unhealthy',
            'database': 'disconnected',
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }), 500

# Define the /api/curation/json endpoint for restaurant JSON storage (Recommended)
@app.route('/api/curation/json', methods=['POST'])
def receive_curation_json():
    """
    Endpoint to receive curation data from Concierge Collector using JSON storage approach.
    Accepts array of restaurant JSON objects and stores each as a complete document.
    This is the recommended approach for flexibility and future-proofing.
    """
    try:
        # Check if content type is JSON
        if not request.is_json:
            return jsonify({"status": "error", "message": "Content-Type must be application/json"}), 400
            
        data = request.get_json()
        
        # Basic validation
        if not isinstance(data, list):
            return jsonify({"status": "error", "message": "Expected array of restaurant objects"}), 400
            
        if len(data) == 0:
            return jsonify({"status": "error", "message": "Empty restaurant array"}), 400
            
        # Process the data
        success, message, processed_count = process_restaurants_json(data)
        
        if success:
            return jsonify({
                "status": "success", 
                "processed": processed_count,
                "message": message
            }), 200
        else:
            app.logger.error(f"JSON processing failed: {message}")
            return jsonify({"status": "error", "message": message}), 500
            
    except Exception as e:
        app.logger.error(f"Error in JSON curation endpoint: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500

# Define the /api/curation endpoint for restaurant data curation (V1 - Legacy)
@app.route('/api/curation', methods=['POST'])
def receive_curation_data():
    """
    Endpoint to receive curation data from Concierge Collector (V1 Legacy Format).
    Processes and stores restaurant data, concepts, and their relationships.
    """
    try:
        # Check if content type is JSON
        if not request.is_json:
            return jsonify({"status": "error", "message": "Content-Type must be application/json"}), 400
            
        data = request.get_json()
        
        # Basic validation
        if not isinstance(data, dict):
            return jsonify({"status": "error", "message": "Invalid JSON format"}), 400
            
        if not all(key in data for key in ["restaurants", "concepts", "restaurantConcepts"]):
            return jsonify({"status": "error", "message": "Missing required fields"}), 400
            
        # Process the data
        success, message = process_curation_data(data)
        
        if success:
            return jsonify({"status": "success"}), 200
        else:
            app.logger.error(f"Data processing failed: {message}")
            return jsonify({"status": "error", "message": message}), 500
            
    except Exception as e:
        app.logger.error(f"Error in curation endpoint: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500

# Define the /api/curation/v2 endpoint for restaurant data curation (V2 - New Format)
@app.route('/api/curation/v2', methods=['POST'])
def receive_curation_data_v2():
    """
    Endpoint to receive curation data from Concierge Collector V2.
    Processes and stores restaurant data with rich metadata structure.
    """
    try:
        # Check if content type is JSON
        if not request.is_json:
            return jsonify({"status": "error", "message": "Content-Type must be application/json"}), 400
            
        data = request.get_json()
        
        # Basic validation
        if not isinstance(data, list):
            return jsonify({"status": "error", "message": "Expected array of restaurants"}), 400
            
        # Process the data
        success, message = process_curation_data_v2(data)
        
        if success:
            return jsonify({"status": "success", "processed": len(data)}), 200
        else:
            app.logger.error(f"V2 Data processing failed: {message}")
            return jsonify({"status": "error", "message": message}), 500
            
    except Exception as e:
        app.logger.error(f"Error in curation V2 endpoint: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500

def process_curation_data(data):
    """
    Process the curation data and insert it into the database.
    
    Args:
        data (dict): The JSON data received from the client
        
    Returns:
        tuple: (success, message) indicating success or failure and a message
    """
    conn = None
    cursor = None
    
    try:
        # Connect to the database
        conn = psycopg2.connect(
            host=os.environ.get("DB_HOST"),
            port=os.environ.get("DB_PORT", 5432),
            database=os.environ.get("DB_NAME"),
            user=os.environ.get("DB_USER"),
            password=os.environ.get("DB_PASSWORD")
        )
        cursor = conn.cursor()
        
        # Process restaurants
        for restaurant in data.get("restaurants", []):
            name = restaurant.get("name")
            if not name:
                continue  # Skip entries without a name
                
            # Insert restaurant if not exists, including server_id for sync tracking
            cursor.execute(
                """
                INSERT INTO restaurants (name, description, transcription, timestamp, server_id)
                VALUES (%s, %s, %s, NOW(), %s)
                ON CONFLICT (name) DO NOTHING
                """,
                (
                    name,
                    restaurant.get("description"),
                    restaurant.get("transcription"),
                    restaurant.get("server_id")  # Track server ID for sync purposes
                )
            )
        
        # Process concepts
        for concept in data.get("concepts", []):
            category_name = concept.get("category")
            value = concept.get("value")
            
            if not category_name or not value:
                continue  # Skip entries without category or value
                
            # Get category_id from concept_categories
            cursor.execute(
                """
                SELECT id FROM concept_categories WHERE name = %s
                """,
                (category_name,)
            )
            category_result = cursor.fetchone()
            
            if category_result:
                category_id = category_result[0]
                
                # Insert concept if not exists
                cursor.execute(
                    """
                    INSERT INTO concepts (category_id, value)
                    VALUES (%s, %s)
                    ON CONFLICT (category_id, value) DO NOTHING
                    """,
                    (category_id, value)
                )
            else:
                app.logger.warning(
                    f"Category '{category_name}' not found in concept_categories"
                )
        
        # Process restaurant concepts
        for rel in data.get("restaurantConcepts", []):
            restaurant_name = rel.get("restaurantName")
            concept_value = rel.get("conceptValue")
            
            if not restaurant_name or not concept_value:
                continue  # Skip entries without restaurant name or concept value
                
            # Get restaurant_id
            cursor.execute(
                """
                SELECT id FROM restaurants WHERE name = %s
                """,
                (restaurant_name,)
            )
            restaurant_result = cursor.fetchone()
            
            if restaurant_result:
                restaurant_id = restaurant_result[0]
                
                # Get concept_id
                cursor.execute(
                    """
                    SELECT c.id FROM concepts c
                    JOIN concept_categories cc ON c.category_id = cc.id
                    WHERE c.value = %s
                    """,
                    (concept_value,)
                )
                concept_result = cursor.fetchone()
                
                if concept_result:
                    concept_id = concept_result[0]
                    
                    # Insert restaurant_concept if not exists
                    cursor.execute(
                        """
                        INSERT INTO restaurant_concepts (restaurant_id, concept_id)
                        VALUES (%s, %s)
                        ON CONFLICT (restaurant_id, concept_id) DO NOTHING
                        """,
                        (restaurant_id, concept_id)
                    )
                else:
                    app.logger.warning(
                        f"Concept '{concept_value}' not found"
                    )
            else:
                app.logger.warning(
                    f"Restaurant '{restaurant_name}' not found"
                )
        
        # Commit the transaction
        conn.commit()
        
        return True, "Data processed successfully"
        
    except Exception as e:
        app.logger.error(f"Error processing curation data: {str(e)}")
        if conn:
            conn.rollback()
        return False, str(e)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def process_curation_data_v2(restaurants_data):
    """
    Process the V2 curation data and insert it into the database.
    
    Args:
        restaurants_data (list): Array of restaurant objects with metadata and categories
        
    Returns:
        tuple: (success, message) indicating success or failure and a message
    """
    conn = None
    cursor = None
    
    try:
        # Connect to the database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        for restaurant_data in restaurants_data:
            if 'metadata' not in restaurant_data:
                continue
                
            # Extract metadata components
            restaurant_metadata = None
            collector_data = None
            michelin_data = None
            google_places_data = None
            
            for metadata_item in restaurant_data['metadata']:
                metadata_type = metadata_item.get('type')
                if metadata_type == 'restaurant':
                    restaurant_metadata = metadata_item
                elif metadata_type == 'collector':
                    collector_data = metadata_item.get('data', {})
                elif metadata_type == 'michelin':
                    michelin_data = metadata_item.get('data', {})
                elif metadata_type == 'google-places':
                    google_places_data = metadata_item.get('data', {})
            
            # Skip if no collector data (required for restaurant name)
            if not collector_data or not collector_data.get('name'):
                continue
                
            # Insert/update restaurant
            restaurant_id = upsert_restaurant_v2(
                cursor, 
                collector_data, 
                restaurant_metadata, 
                michelin_data, 
                google_places_data
            )
            
            if restaurant_id:
                # Process curator categories
                process_curator_categories_v2(cursor, restaurant_id, restaurant_data)
                
                # Process photos if they exist
                if 'photos' in collector_data:
                    process_photos_v2(cursor, restaurant_id, collector_data['photos'])
        
        # Commit the transaction
        conn.commit()
        
        return True, "V2 data processed successfully"
        
    except Exception as e:
        app.logger.error(f"Error processing V2 curation data: {str(e)}")
        if conn:
            conn.rollback()
        return False, str(e)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def upsert_restaurant_v2(cursor, collector_data, restaurant_metadata, michelin_data, google_places_data):
    """
    Insert or update restaurant with V2 data structure.
    
    Returns:
        int: restaurant_id if successful, None otherwise
    """
    try:
        name = collector_data.get('name')
        description = collector_data.get('description')
        transcription = collector_data.get('transcription')
        
        # Location data
        location = collector_data.get('location', {})
        latitude = location.get('latitude')
        longitude = location.get('longitude')
        address = location.get('address')
        location_entered_by = location.get('enteredBy')
        
        # Notes
        notes = collector_data.get('notes', {})
        private_notes = notes.get('private')
        public_notes = notes.get('public')
        
        # Restaurant metadata (if exists)
        local_id = restaurant_metadata.get('id') if restaurant_metadata else None
        server_id = restaurant_metadata.get('serverId') if restaurant_metadata else None
        created_timestamp = restaurant_metadata.get('created', {}).get('timestamp') if restaurant_metadata else None
        curator_id = restaurant_metadata.get('created', {}).get('curator', {}).get('id') if restaurant_metadata else None
        curator_name = restaurant_metadata.get('created', {}).get('curator', {}).get('name') if restaurant_metadata else None
        
        # Sync data
        sync_data = restaurant_metadata.get('sync', {}) if restaurant_metadata else {}
        sync_status = sync_data.get('status')
        last_synced_at = sync_data.get('lastSyncedAt')
        deleted_locally = sync_data.get('deletedLocally', False)
        
        # Michelin data
        michelin_id = michelin_data.get('michelinId') if michelin_data else None
        michelin_stars = michelin_data.get('rating', {}).get('stars') if michelin_data else None
        michelin_distinction = michelin_data.get('rating', {}).get('distinction') if michelin_data else None
        michelin_description = michelin_data.get('michelinDescription') if michelin_data else None
        michelin_url = michelin_data.get('michelinUrl') if michelin_data else None
        
        # Google Places data
        google_place_id = google_places_data.get('placeId') if google_places_data else None
        google_rating = google_places_data.get('rating', {}).get('average') if google_places_data else None
        google_total_ratings = google_places_data.get('rating', {}).get('totalRatings') if google_places_data else None
        google_price_level = google_places_data.get('rating', {}).get('priceLevel') if google_places_data else None
        
        # Insert or update restaurant (first check if table exists, fall back to legacy if needed)
        try:
            cursor.execute("""
                INSERT INTO restaurants_v2 (
                    name, description, transcription, 
                    latitude, longitude, address, location_entered_by,
                    private_notes, public_notes,
                    local_id, server_id, created_timestamp, curator_id, curator_name,
                    sync_status, last_synced_at, deleted_locally,
                    michelin_id, michelin_stars, michelin_distinction, michelin_description, michelin_url,
                    google_place_id, google_rating, google_total_ratings, google_price_level,
                    metadata_json, created_at, updated_at
                ) VALUES (
                    %s, %s, %s, 
                    %s, %s, %s, %s,
                    %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, NOW(), NOW()
                )
                ON CONFLICT (name) DO UPDATE SET
                    description = EXCLUDED.description,
                    transcription = EXCLUDED.transcription,
                    latitude = EXCLUDED.latitude,
                    longitude = EXCLUDED.longitude,
                    address = EXCLUDED.address,
                    location_entered_by = EXCLUDED.location_entered_by,
                    private_notes = EXCLUDED.private_notes,
                    public_notes = EXCLUDED.public_notes,
                    server_id = EXCLUDED.server_id,
                    sync_status = EXCLUDED.sync_status,
                    last_synced_at = EXCLUDED.last_synced_at,
                    deleted_locally = EXCLUDED.deleted_locally,
                    michelin_id = EXCLUDED.michelin_id,
                    michelin_stars = EXCLUDED.michelin_stars,
                    michelin_distinction = EXCLUDED.michelin_distinction,
                    michelin_description = EXCLUDED.michelin_description,
                    michelin_url = EXCLUDED.michelin_url,
                    google_place_id = EXCLUDED.google_place_id,
                    google_rating = EXCLUDED.google_rating,
                    google_total_ratings = EXCLUDED.google_total_ratings,
                    google_price_level = EXCLUDED.google_price_level,
                    metadata_json = EXCLUDED.metadata_json,
                    updated_at = NOW()
                RETURNING id
            """, (
                name, description, transcription,
                latitude, longitude, address, location_entered_by,
                private_notes, public_notes,
                local_id, server_id, created_timestamp, curator_id, curator_name,
                sync_status, last_synced_at, deleted_locally,
                michelin_id, michelin_stars, michelin_distinction, michelin_description, michelin_url,
                google_place_id, google_rating, google_total_ratings, google_price_level,
                json.dumps({'michelin': michelin_data, 'google_places': google_places_data}) if (michelin_data or google_places_data) else None
            ))
        except psycopg2.errors.UndefinedTable:
            # Fall back to legacy table if V2 table doesn't exist
            app.logger.warning("restaurants_v2 table not found, falling back to legacy restaurants table")
            cursor.execute("""
                INSERT INTO restaurants (name, description, transcription, server_id, timestamp)
                VALUES (%s, %s, %s, %s, NOW())
                ON CONFLICT (name) DO UPDATE SET
                    description = EXCLUDED.description,
                    transcription = EXCLUDED.transcription,
                    server_id = EXCLUDED.server_id
                RETURNING id
            """, (name, description, transcription, server_id))
        
        result = cursor.fetchone()
        return result[0] if result else None
        
    except Exception as e:
        app.logger.error(f"Error upserting restaurant: {str(e)}")
        return None


def process_curator_categories_v2(cursor, restaurant_id, restaurant_data):
    """
    Process curator categories for a restaurant in V2 format.
    """
    # Category mappings from V2 format
    category_fields = [
        'Cuisine', 'Menu', 'Price Range', 'Mood', 'Setting', 
        'Crowd', 'Suitable For', 'Food Style', 'Drinks', 'Special Features'
    ]
    
    for category_name in category_fields:
        if category_name in restaurant_data:
            values = restaurant_data[category_name]
            if isinstance(values, list):
                for value in values:
                    if value and value.strip():
                        # Get or create concept category
                        cursor.execute("""
                            INSERT INTO concept_categories (name) 
                            VALUES (%s) 
                            ON CONFLICT (name) DO NOTHING
                            RETURNING id
                        """, (category_name,))
                        
                        result = cursor.fetchone()
                        if result:
                            category_id = result[0]
                        else:
                            cursor.execute("SELECT id FROM concept_categories WHERE name = %s", (category_name,))
                            category_id = cursor.fetchone()[0]
                        
                        # Get or create concept
                        cursor.execute("""
                            INSERT INTO concepts (category_id, value) 
                            VALUES (%s, %s) 
                            ON CONFLICT (category_id, value) DO NOTHING
                            RETURNING id
                        """, (category_id, value.strip()))
                        
                        result = cursor.fetchone()
                        if result:
                            concept_id = result[0]
                        else:
                            cursor.execute(
                                "SELECT id FROM concepts WHERE category_id = %s AND value = %s", 
                                (category_id, value.strip())
                            )
                            concept_id = cursor.fetchone()[0]
                        
                        # Link restaurant to concept
                        cursor.execute("""
                            INSERT INTO restaurant_concepts (restaurant_id, concept_id) 
                            VALUES (%s, %s) 
                            ON CONFLICT (restaurant_id, concept_id) DO NOTHING
                        """, (restaurant_id, concept_id))


def process_photos_v2(cursor, restaurant_id, photos):
    """
    Process and store photos for a restaurant.
    """
    for photo in photos:
        photo_id = photo.get('id')
        photo_data = photo.get('photoData')
        captured_by = photo.get('capturedBy')
        timestamp = photo.get('timestamp')
        
        if photo_data:
            try:
                cursor.execute("""
                    INSERT INTO restaurant_photos (
                        restaurant_id, photo_id, photo_data, captured_by, timestamp, created_at
                    ) VALUES (%s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (restaurant_id, photo_id) DO UPDATE SET
                        photo_data = EXCLUDED.photo_data,
                        captured_by = EXCLUDED.captured_by,
                        timestamp = EXCLUDED.timestamp
                """, (restaurant_id, photo_id, photo_data, captured_by, timestamp))
            except psycopg2.errors.UndefinedTable:
                # Photos table doesn't exist yet, skip photo processing
                app.logger.warning("restaurant_photos table not found, skipping photo processing")
                break


def process_restaurants_json(restaurants_data):
    """
    Process restaurant JSON data and store each restaurant as a complete document.
    Uses composite key (restaurant_name + city + curator_id) to prevent duplicates.
    
    Args:
        restaurants_data (list): Array of restaurant JSON objects
        
    Returns:
        tuple: (success, message, processed_count)
    """
    conn = None
    cursor = None
    processed_count = 0
    skipped_count = 0
    
    try:
        # Connect to the database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        for restaurant_json in restaurants_data:
            # Extract composite key components
            name = extract_restaurant_name_from_json(restaurant_json)
            city = extract_city_from_json(restaurant_json)
            curator_info = extract_curator_info_from_json(restaurant_json)
            
            if not name or not city or not curator_info:
                app.logger.warning(f"Skipping restaurant without required data: name={name}, city={city}, curator={curator_info}")
                skipped_count += 1
                continue
            
            curator_id = curator_info.get('id')
            curator_name = curator_info.get('name')
            
            # Extract additional metadata
            restaurant_id = extract_restaurant_id_from_json(restaurant_json)
            server_id = extract_server_id_from_json(restaurant_json)
            location_info = extract_location_info_from_json(restaurant_json)
            
            # Store the complete JSON document with composite key
            try:
                cursor.execute("""
                    INSERT INTO restaurants_json (
                        restaurant_name, city, curator_id, curator_name,
                        restaurant_id, server_id, restaurant_data,
                        latitude, longitude, full_address
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (restaurant_name, city, curator_id) DO UPDATE SET
                        curator_name = EXCLUDED.curator_name,
                        restaurant_id = EXCLUDED.restaurant_id,
                        server_id = EXCLUDED.server_id,
                        restaurant_data = EXCLUDED.restaurant_data,
                        latitude = EXCLUDED.latitude,
                        longitude = EXCLUDED.longitude,
                        full_address = EXCLUDED.full_address,
                        updated_at = NOW()
                """, (
                    name, city, curator_id, curator_name,
                    restaurant_id, server_id, json.dumps(restaurant_json),
                    location_info.get('latitude'), location_info.get('longitude'), location_info.get('address')
                ))
            except psycopg2.errors.UndefinedTable:
                # restaurants_json table doesn't exist, create a minimal fallback
                app.logger.warning("restaurants_json table not found, falling back to legacy processing")
                skipped_count += 1
                continue
            
            processed_count += 1
        
        # Commit the transaction
        conn.commit()
        
        message = f"Successfully processed {processed_count} restaurants"
        if skipped_count > 0:
            message += f", skipped {skipped_count} entries"
        
        return True, message, processed_count
        
    except Exception as e:
        app.logger.error(f"Error processing JSON restaurant data: {str(e)}")
        if conn:
            conn.rollback()
        return False, str(e), processed_count
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def extract_city_from_json(restaurant_json):
    """
    Extract city from JSON structure with priority order:
    1. Michelin Guide city (most reliable)
    2. Google Places vicinity/address
    3. Collector address parsing
    """
    try:
        if 'metadata' not in restaurant_json:
            return None
            
        # Priority 1: Michelin Guide city
        for metadata_item in restaurant_json['metadata']:
            if metadata_item.get('type') == 'michelin':
                data = metadata_item.get('data', {})
                guide = data.get('guide', {})
                city = guide.get('city')
                if city and city.strip():
                    return city.strip()
        
        # Priority 2: Google Places vicinity
        for metadata_item in restaurant_json['metadata']:
            if metadata_item.get('type') == 'google-places':
                data = metadata_item.get('data', {})
                location = data.get('location', {})
                vicinity = location.get('vicinity')
                if vicinity:
                    # Extract city from vicinity (e.g., "Via Stella, 22, Modena" -> "Modena")
                    parts = vicinity.split(',')
                    if len(parts) > 1:
                        city = parts[-1].strip()
                        if city and not city.isdigit():
                            return city
                
                # Try formatted address
                formatted_address = location.get('formattedAddress')
                if formatted_address:
                    city = parse_city_from_address(formatted_address)
                    if city:
                        return city
        
        # Priority 3: Collector address
        for metadata_item in restaurant_json['metadata']:
            if metadata_item.get('type') == 'collector':
                data = metadata_item.get('data', {})
                location = data.get('location', {})
                address = location.get('address')
                if address:
                    city = parse_city_from_address(address)
                    if city:
                        return city
        
        return 'Unknown'
    except Exception as e:
        app.logger.error(f"Error extracting city: {str(e)}")
        return 'Unknown'


def parse_city_from_address(address):
    """
    Parse city from address string.
    Handles various address formats.
    """
    if not address:
        return None
    
    try:
        parts = [part.strip() for part in address.split(',')]
        
        for part in parts:
            # Skip if it's clearly not a city
            if not part or part.isdigit() or len(part) < 2:
                continue
            
            # Skip postal codes (mostly numbers)
            if len(part) <= 6 and part.replace(' ', '').isdigit():
                continue
            
            # Skip common country names
            if part.upper() in ['ITALY', 'FRANCE', 'USA', 'UNITED STATES', 'UK', 'GERMANY', 'SPAIN', 'JAPAN']:
                continue
            
            # Skip street addresses (start with numbers)
            if part[0].isdigit():
                continue
            
            # Clean up postal codes from city names (e.g., "41121 Modena MO" -> "Modena")
            cleaned = ' '.join([word for word in part.split() if not word.isdigit() and len(word) > 2])
            if cleaned and len(cleaned) > 1:
                return cleaned
        
        return None
    except Exception:
        return None


def extract_curator_info_from_json(restaurant_json):
    """
    Extract curator information from JSON structure.
    """
    try:
        if 'metadata' not in restaurant_json:
            return None
            
        for metadata_item in restaurant_json['metadata']:
            if metadata_item.get('type') == 'restaurant':
                # Try created curator first
                created = metadata_item.get('created', {})
                curator = created.get('curator', {})
                if curator.get('id'):
                    return {
                        'id': int(curator['id']),
                        'name': curator.get('name', 'Unknown')
                    }
                
                # Try modified curator
                modified = metadata_item.get('modified', {})
                curator = modified.get('curator', {})
                if curator.get('id'):
                    return {
                        'id': int(curator['id']),
                        'name': curator.get('name', 'Unknown')
                    }
        
        # Fallback: return unknown curator
        return {'id': 0, 'name': 'Unknown'}
    except Exception as e:
        app.logger.error(f"Error extracting curator info: {str(e)}")
        return {'id': 0, 'name': 'Unknown'}


def extract_location_info_from_json(restaurant_json):
    """
    Extract location information from JSON structure.
    """
    try:
        if 'metadata' not in restaurant_json:
            return {}
            
        # Try collector location first
        for metadata_item in restaurant_json['metadata']:
            if metadata_item.get('type') == 'collector':
                data = metadata_item.get('data', {})
                location = data.get('location', {})
                if location.get('latitude') and location.get('longitude'):
                    return {
                        'latitude': float(location['latitude']),
                        'longitude': float(location['longitude']),
                        'address': location.get('address')
                    }
        
        # Try Google Places location
        for metadata_item in restaurant_json['metadata']:
            if metadata_item.get('type') == 'google-places':
                data = metadata_item.get('data', {})
                location = data.get('location', {})
                if location.get('latitude') and location.get('longitude'):
                    return {
                        'latitude': float(location['latitude']),
                        'longitude': float(location['longitude']),
                        'address': location.get('formattedAddress')
                    }
        
        return {}
    except Exception as e:
        app.logger.error(f"Error extracting location info: {str(e)}")
        return {}


def extract_restaurant_name_from_json(restaurant_json):
    """
    Extract restaurant name from JSON structure.
    Looks in collector metadata for the name field.
    """
    try:
        if 'metadata' not in restaurant_json:
            return None
            
        for metadata_item in restaurant_json['metadata']:
            if metadata_item.get('type') == 'collector':
                data = metadata_item.get('data', {})
                name = data.get('name')
                if name:
                    return name.strip()
        
        return None
    except Exception as e:
        app.logger.error(f"Error extracting restaurant name: {str(e)}")
        return None


def extract_restaurant_id_from_json(restaurant_json):
    """
    Extract restaurant ID from JSON structure.
    Looks in restaurant metadata for the id field.
    """
    try:
        if 'metadata' not in restaurant_json:
            return None
            
        for metadata_item in restaurant_json['metadata']:
            if metadata_item.get('type') == 'restaurant':
                restaurant_id = metadata_item.get('id')
                if restaurant_id:
                    return int(restaurant_id)
        
        return None
    except Exception as e:
        app.logger.error(f"Error extracting restaurant ID: {str(e)}")
        return None


def extract_server_id_from_json(restaurant_json):
    """
    Extract server ID from JSON structure.
    Looks in restaurant metadata for the serverId field.
    """
    try:
        if 'metadata' not in restaurant_json:
            return None
            
        for metadata_item in restaurant_json['metadata']:
            if metadata_item.get('type') == 'restaurant':
                server_id = metadata_item.get('serverId')
                if server_id:
                    return int(server_id)
        
        return None
    except Exception as e:
        app.logger.error(f"Error extracting server ID: {str(e)}")
        return None


@app.route('/status', methods=['GET'])
def status():
    """Health check endpoint to verify server is running"""
    return jsonify({
        "status": "ok", 
        "version": "1.1.2",
        "timestamp": datetime.now().isoformat()
    })

@app.route('/')
def index():
    logger.info("→ Entrou no index() do concierge_parser")
    return render_template('index.html')

@app.route('/ping')
def ping():
    return 'pong', 200

# Set up logging
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class PersonaAnalyzer:
    def __init__(self, csv_path=None):
        self.personas = []
        self.persona_inputs = {}
        self.persona_recommendations = {}
        
        if csv_path:
            self.load_personas_from_csv(csv_path)
    
    def load_personas_from_csv(self, csv_path):
        """Load personas from CSV file"""
        try:
            logger.info(f"Loading personas from: {csv_path}")
            df = pd.read_csv(csv_path)
            
            # Process each row in the CSV
            for _, row in df.iterrows():
                persona_id = row.get('No.')
                if not isinstance(persona_id, str) or not persona_id:
                    continue
                    
                persona = row.get('PERSONA', '')
                input_text = row.get('Input', '')
                
                # Get the recommended options (up to 3)
                options = []
                for i in range(1, 4):
                    option_col = f'Anwar - Option {i}'
                    if option_col in row and pd.notna(row[option_col]):
                        options.append(row[option_col])
                
                # Store the persona information
                persona_info = {
                    'id': persona_id,
                    'description': persona,
                    'input': input_text,
                    'recommendations': options
                }
                
                self.personas.append(persona_info)
                
                # Create lookup dictionaries for faster matching
                if input_text:
                    self.persona_inputs[input_text.lower()] = persona_id
                
                # Store recommendations by persona ID
                self.persona_recommendations[persona_id] = options
            
            logger.info(f"Loaded {len(self.personas)} personas")
            return True
        except Exception as e:
            logger.error(f"Error loading personas from CSV: {str(e)}")
            logger.error(traceback.format_exc())
            return False
    
    def match_conversation_to_persona(self, conversation):
        """Match a conversation to a persona based on user request"""
        user_request = next((msg['content'] for msg in conversation if msg['type'] == 'user_request'), None)
        
        if not user_request:
            return None
            
        # Try exact match first
        user_request_lower = user_request.lower().strip()
        if user_request_lower in self.persona_inputs:
            return self.persona_inputs[user_request_lower]
            
        # If no exact match, try fuzzy matching
        for input_text, persona_id in self.persona_inputs.items():
            # Simple similarity check - percentage of input_text words in user_request
            input_words = set(input_text.lower().split())
            request_words = set(user_request_lower.split())
            
            common_words = input_words.intersection(request_words)
            
            # If more than 70% of the words match, consider it a match
            if len(common_words) >= 0.7 * len(input_words):
                return persona_id
                
        return None
    
    def evaluate_recommendations(self, conversation, persona_id):
        """Evaluate how well the recommendations match the expected ones for the persona"""
        if not persona_id or persona_id not in self.persona_recommendations:
            return {
                'matched': False,
                'expected_recommendations': [],
                'actual_recommendations': [],
                'accuracy': 0,
                'precision': 0,
                'recall': 0,
                'extra_count': 0,
                'missing_count': 0,
                'position_analysis': []
            }
            
        # Get expected recommendations for this persona
        expected = self.persona_recommendations.get(persona_id, [])
        
        # Extract actual recommendations from the conversation
        actual = []
        for msg in conversation:
            if msg['type'] == 'recommendation':
                content = msg['content']
                # Extract restaurant names using regex
                restaurant_pattern = r'- ([^:]+?)(?=\s*–|\s*-|\s*\n|$)'
                extracted = re.findall(restaurant_pattern, content)
                actual = [rest.strip() for rest in extracted]
                break
        
        # Calculate accuracy (percentage of expected recommendations present in actual)
        matches = 0
        matched_items = []
        position_analysis = []
        
        for i, exp in enumerate(expected):
            matched = False
            matched_position = -1
            for j, act in enumerate(actual):
                # More precise matching algorithm to avoid confusing similar restaurant names
                # Check for exact match (case-insensitive) or high similarity
                if self._is_same_restaurant(exp, act):
                    matched = True
                    matched_items.append(exp)
                    matched_position = j
                    break
            
            # Record position analysis
            position_analysis.append({
                'expected': exp,
                'found': matched,
                'position': matched_position,
                'position_score': 1.0 if matched_position == i else 
                                  0.67 if matched_position >= 0 and matched_position < len(expected) else
                                  0.33 if matched_position >= 0 else 0
            })
            
            if matched:
                matches += 1
        
        # Calculate metrics
        accuracy = matches / len(expected) if expected else 0
        precision = matches / len(actual) if actual else 0
        recall = matches / len(expected) if expected else 0
        
        # Count extra and missing recommendations
        extra_count = len(actual) - matches if len(actual) > matches else 0
        missing_count = len(expected) - matches
        
        # Get list of extra recommendations
        extra_recommendations = [rec for rec in actual if not any(
            self._is_same_restaurant(exp, rec) for exp in expected
        )]
        
        return {
            'matched': True,
            'expected_recommendations': expected,
            'actual_recommendations': actual,
            'matched_items': matched_items,
            'extra_recommendations': extra_recommendations,
            'accuracy': accuracy,
            'precision': precision,
            'recall': recall,
            'extra_count': extra_count,
            'missing_count': missing_count,
            'position_analysis': position_analysis
        }
    
    def _is_same_restaurant(self, name1, name2):
        """
        More precise algorithm to determine if two restaurant names refer to the same place
        """
        # Convert to lowercase for case-insensitive comparison
        name1 = name1.lower().strip()
        name2 = name2.lower().strip()
        
        # Exact match
        if name1 == name2:
            return True
        
        # Special case for restaurants with special characters or common words
        # Split into words and check word similarity
        words1 = set(name1.split())
        words2 = set(name2.split())
        
        # Very common words in restaurant names that shouldn't determine a match by themselves
        common_words = {'the', 'restaurant', 'café', 'cafe', 'bar', 'grill', 'bistro', 'kitchen'}
        
        # Remove common words for comparison
        filtered_words1 = words1 - common_words
        filtered_words2 = words2 - common_words
        
        # Check if one is a subset of the other, but only if they share substantial words
        # This prevents "Parigi" from matching with "Bistrot Parigi"
        if filtered_words1 and filtered_words2:
            shared_words = filtered_words1.intersection(filtered_words2)
            # Only consider a match if they share significant unique words AND
            # the length difference isn't too great (to avoid matching distinct places like "Parigi" vs "Bistrot Parigi")
            if len(shared_words) >= min(len(filtered_words1), len(filtered_words2)) * 0.8:
                # Additional length check to distinguish "Parigi" from "Bistrot Parigi"
                shorter = name1 if len(name1) < len(name2) else name2
                longer = name2 if len(name1) < len(name2) else name1
                
                # If the longer name is significantly longer, it's probably a different restaurant
                # Unless the shorter name is fully contained as a distinct word in the longer name
                if len(longer) > len(shorter) * 1.5:
                    # Check if shorter name appears as a complete word in longer name
                    longer_words = longer.split()
                    # Not a match if shorter name is just one word in a multi-word longer name
                    if shorter in longer_words and len(longer_words) > 1:
                        return False
                    
                return True
        
        return False

class ConciergeParser:
    def __init__(self):
        self.conversations = []
        self.current_conversation = []
        self.debug_data = []
        self.persona_analyzer = None
        self.sheet_restaurants = []  # New property to store restaurant names from sheets
        
    def load_personas(self, csv_path):
        """Load personas from CSV file"""
        self.persona_analyzer = PersonaAnalyzer(csv_path)
        return len(self.persona_analyzer.personas) > 0
        
    def parse_whatsapp_chat(self, chat_text):
        """Parse WhatsApp chat text into structured conversations"""
        # Reset data
        self.conversations = []
        self.current_conversation = []
        self.debug_data = []
        
        logger.info(f"Starting to parse chat data of length {len(chat_text)}")
        
        try:
            # Regular expression to match WhatsApp message format
            message_pattern = r'\[(.*?)\] (.*?): (.*?)(?=\[\d{4}-\d{2}-\d{2}|$)'
            
            # Find all messages
            messages = re.findall(message_pattern, chat_text, re.DOTALL)
            logger.info(f"Found {len(messages)} messages in chat")
            
            # Process each message
            conversation_id = 0
            previous_sender = None
            
            for i, (timestamp_str, sender, content) in enumerate(messages):
                # Parse timestamp
                timestamp = datetime.strptime(timestamp_str, '%Y-%m-%d, %I:%M:%S %p')
                
                # Create message object
                message = {
                    'timestamp': timestamp,
                    'sender': sender,
                    'content': content.strip(),
                    'type': self._determine_message_type(content.strip(), sender),
                    'conversation_id': conversation_id
                }
                
                # Extract debug data if present
                if message['type'] == 'debug':
                    debug_info = self._extract_debug_info(content.strip())
                    if debug_info:
                        message['debug_info'] = debug_info
                        self.debug_data.append({
                            'conversation_id': conversation_id,
                            'timestamp': timestamp,
                            'debug_type': debug_info['type'],
                            'data': debug_info['data']
                        })
                
                # Check if this is a new conversation
                if sender == 'Wagner' and (previous_sender != 'Wagner' or i == 0):
                    if i > 0:
                        self.conversations.append(self.current_conversation)
                        conversation_id += 1
                    self.current_conversation = []
                
                # Add message to current conversation
                self.current_conversation.append(message)
                previous_sender = sender
            
            # Add the last conversation
            if self.current_conversation:
                self.conversations.append(self.current_conversation)
                
            # Perform persona matching if persona data is loaded
            if self.persona_analyzer:
                self.analyze_personas()
                
            logger.info(f"Parsed {len(self.conversations)} conversations")
            return self.conversations
        except Exception as e:
            logger.error(f"Error parsing chat: {str(e)}")
            logger.error(traceback.format_exc())
            raise
    
    def _determine_message_type(self, content, sender):
        """Determine the type of message based on content and sender"""
        if sender == 'Wagner':
            return 'user_request'
        elif 'Please, wait' in content or 'Por favor, aguarde' in content:
            return 'processing'
        elif content.startswith('[DEBUG]'):
            return 'debug'
        elif '‎audio omitted' in content:
            return 'audio'
        else:
            return 'recommendation'
    
    def _extract_debug_info(self, content):
        """Extract structured information from debug messages"""
        if '[DEBUG] Metadados relacionados' in content:
            try:
                # Extract the metadata list
                metadata_str = content.replace('[DEBUG] Metadados relacionados ', '')
                metadata_data = ast.literal_eval(metadata_str)
                return {
                    'type': 'metadata',
                    'data': metadata_data
                }
            except:
                return None
                
        elif '[DEBUG] Contexto entendido' in content:
            try:
                # Extract the context dictionary
                context_str = content.replace('[DEBUG] Contexto entendido: ', '')
                context_data = ast.literal_eval(context_str)
                return {
                    'type': 'context',
                    'data': context_data
                }
            except:
                return None
                
        elif '[DEBUG] Restaurantes candidatos' in content:
            try:
                # Extract the restaurants dictionary
                restaurants_str = content.replace('[DEBUG] Restaurantes candidatos: ', '')
                restaurants_data = ast.literal_eval(restaurants_str)
                return {
                    'type': 'candidates',
                    'data': restaurants_data
                }
            except:
                return None
        
        return None
    
    def analyze_personas(self):
        """Match conversations to personas and evaluate recommendations"""
        if not self.persona_analyzer:
            logger.warning("No persona data loaded, skipping persona analysis")
            return
            
        for i, conversation in enumerate(self.conversations):
            # Match the conversation to a persona
            persona_id = self.persona_analyzer.match_conversation_to_persona(conversation)
            
            if persona_id:
                # Evaluate recommendation accuracy
                evaluation = self.persona_analyzer.evaluate_recommendations(conversation, persona_id)
                
                # If we have sheet restaurants, try to match expected recommendations to sheet names
                if self.sheet_restaurants and 'expected_recommendations' in evaluation:
                    matched_expected = []
                    for rec in evaluation['expected_recommendations']:
                        sheet_match = self.match_restaurant_to_sheet(rec)
                        matched_expected.append({
                            'original': rec,
                            'sheet_match': sheet_match,
                            'name': sheet_match if sheet_match else rec
                        })
                    evaluation['matched_expected'] = matched_expected
                
                # Find matching persona info
                persona_info = next((p for p in self.persona_analyzer.personas if p['id'] == persona_id), None)
                
                # Store the persona and evaluation information with the conversation
                for msg in conversation:
                    msg['persona_id'] = persona_id
                    if persona_info:
                        msg['persona_description'] = persona_info.get('description', '')
                
                # Store evaluation with the recommendation message
                for msg in conversation:
                    if msg['type'] == 'recommendation':
                        msg['recommendation_evaluation'] = evaluation
                        break
    
    def get_conversation_metrics(self):
        """Generate metrics for all conversations"""
        metrics = []
        
        for i, conversation in enumerate(self.conversations):
            # Extract request
            user_request = next((msg['content'] for msg in conversation if msg['type'] == 'user_request'), None)
            
            # Extract timestamps for different response time calculations
            request_time = next((msg['timestamp'] for msg in conversation if msg['type'] == 'user_request'), None)
            first_response_time = next((msg['timestamp'] for msg in conversation 
                                       if msg['type'] not in ['user_request'] and 
                                       msg['sender'] != 'Wagner'), None)
            processing_time = next((msg['timestamp'] for msg in conversation if msg['type'] == 'processing'), None)
            recommendation_time = next((msg['timestamp'] for msg in conversation if msg['type'] == 'recommendation'), None)
            last_message_time = conversation[-1]['timestamp'] if conversation else None
            
            # Calculate different response time metrics
            time_to_first_response = None
            time_to_processing = None
            time_to_recommendation = None
            total_conversation_time = None
            
            if request_time and first_response_time:
                time_to_first_response = (first_response_time - request_time).total_seconds()
                
            if request_time and processing_time:
                time_to_processing = (processing_time - request_time).total_seconds()
                
            if request_time and recommendation_time:
                time_to_recommendation = (recommendation_time - request_time).total_seconds()
                
            if request_time and last_message_time:
                total_conversation_time = (last_message_time - request_time).total_seconds()
            
            # Count debug messages
            debug_count = sum(1 for msg in conversation if msg['type'] == 'debug')
            
            # Extract metadata count if available
            metadata_count = 0
            context_keys = []
            for msg in conversation:
                if msg['type'] == 'debug' and 'debug_info' in msg:
                    if msg['debug_info']['type'] == 'metadata':
                        metadata_count = len(msg['debug_info']['data'])
                    elif msg['debug_info']['type'] == 'context':
                        if 'results' in msg['debug_info']['data']:
                            context_keys = list(msg['debug_info']['data']['results'].keys())
            
            # Add persona information if available
            persona_id = next((msg.get('persona_id') for msg in conversation if 'persona_id' in msg), None)
            persona_description = next((msg.get('persona_description') for msg in conversation if 'persona_description' in msg), None)
            
            # Add recommendation accuracy if available
            recommendation_accuracy = None
            for msg in conversation:
                if msg['type'] == 'recommendation' and 'recommendation_evaluation' in msg:
                    evaluation = msg['recommendation_evaluation']
                    recommendation_accuracy = evaluation.get('accuracy')
                    break
            
            metrics_item = {
                'conversation_id': i,
                'request': user_request,
                'time_to_first_response': time_to_first_response,
                'time_to_processing': time_to_processing,
                'time_to_recommendation': time_to_recommendation,
                'total_conversation_time': total_conversation_time,
                'debug_count': debug_count,
                'metadata_count': metadata_count,
                'context_keys': context_keys
            }
            
            # Add persona information if available
            if persona_id:
                metrics_item['persona_id'] = persona_id
                metrics_item['persona_description'] = persona_description
                
            # Add recommendation accuracy if available
            if recommendation_accuracy is not None:
                metrics_item['recommendation_accuracy'] = recommendation_accuracy
            
            metrics.append(metrics_item)
        
        return metrics
    
    def match_restaurant_to_sheet(self, restaurant_name):
        """Match a restaurant name to a sheet restaurant name using similarity matching"""
        if not self.sheet_restaurants or not restaurant_name:
            return None
            
        # First try exact match (case insensitive)
        for sheet_name in self.sheet_restaurants:
            if restaurant_name.lower().strip() == sheet_name.lower().strip():
                return sheet_name
                
        # If no exact match, try restaurant name similarity algorithm
        if self.persona_analyzer:
            for sheet_name in self.sheet_restaurants:
                if self.persona_analyzer._is_same_restaurant(restaurant_name, sheet_name):
                    return sheet_name
                    
        return None
    
    def extract_restaurant_recommendations(self):
        """Extract restaurant recommendations from all conversations"""
        recommendations = []
        
        for i, conversation in enumerate(self.conversations):
            # Get user request
            user_request = next((msg['content'] for msg in conversation if msg['type'] == 'user_request'), "No request")
            
            # Get recommendation content
            recommendation_msg = next((msg for msg in conversation if msg['type'] == 'recommendation'), None)
            
            if recommendation_msg:
                # Extract restaurant names (this is a simple extraction; might need refinement)
                content = recommendation_msg['content']
                # Look for restaurant names that are typically followed by a dash or hyphen
                restaurant_pattern = r'[-–]\s*(.*?)(?=\s*[-–]|\n|$)'
                potential_restaurants = re.findall(r'- ([^:]+?)(?=\s*–|\s*-|\s*\n|$)', content)
                
                # Match potential restaurants with sheet restaurants
                matched_restaurants = []
                for restaurant in potential_restaurants:
                    sheet_match = self.match_restaurant_to_sheet(restaurant)
                    matched_restaurants.append({
                        'extracted': restaurant,
                        'sheet_match': sheet_match,
                        'name': sheet_match if sheet_match else restaurant  # Use sheet name if matched
                    })
                
                # Add candidate restaurants from debug data if available
                candidate_restaurants = []
                for msg in conversation:
                    if msg['type'] == 'debug' and 'debug_info' in msg:
                        if msg['debug_info']['type'] == 'candidates' and 'results' in msg['debug_info']['data']:
                            for key, values in msg['debug_info']['data']['results'].items():
                                if isinstance(values, list):
                                    for value in values:
                                        if ' -> ' in value:
                                            parts = value.split(' -> ')
                                            if len(parts) > 1:
                                                candidate_name = parts[1]
                                                sheet_match = self.match_restaurant_to_sheet(candidate_name)
                                                candidate_restaurants.append({
                                                    'category': key,
                                                    'extracted': candidate_name,
                                                    'sheet_match': sheet_match,
                                                    'name': sheet_match if sheet_match else candidate_name
                                                })
                
                # Get persona information if available
                persona_id = next((msg.get('persona_id') for msg in conversation if 'persona_id' in msg), None)
                persona_description = next((msg.get('persona_description') for msg in conversation if 'persona_description' in msg), None)
                
                # Get recommendation evaluation if available
                evaluation = recommendation_msg.get('recommendation_evaluation', {})
                expected_recommendations = evaluation.get('expected_recommendations', [])
                accuracy = evaluation.get('accuracy', None)
                
                # If we have sheet restaurants and expected recommendations, match those too
                matched_expected = []
                if expected_recommendations and self.sheet_restaurants:
                    for rec in expected_recommendations:
                        sheet_match = self.match_restaurant_to_sheet(rec)
                        matched_expected.append({
                            'extracted': rec,
                            'sheet_match': sheet_match,
                            'name': sheet_match if sheet_match else rec
                        })
                
                recommendation_item = {
                    'conversation_id': i,
                    'request': user_request,
                    'potential_restaurants': potential_restaurants,  # Keep original for backward compatibility
                    'matched_restaurants': matched_restaurants,     # New field with matching information
                    'candidate_restaurants': candidate_restaurants,
                    'sheet_restaurants': self.sheet_restaurants,
                    'full_recommendation': content
                }
                
                # Add persona information if available
                if persona_id:
                    recommendation_item['persona_id'] = persona_id
                    recommendation_item['persona_description'] = persona_description
                    
                # Add recommendation evaluation if available
                if evaluation:
                    recommendation_item['expected_restaurants'] = expected_recommendations  # Keep original
                    recommendation_item['matched_expected'] = matched_expected              # Add matched version
                    recommendation_item['accuracy'] = accuracy
                
                recommendations.append(recommendation_item)
        
        return recommendations

    def extract_sheet_restaurants(self, file):
        """Extract restaurant names from sheet names in Excel files"""
        self.sheet_restaurants = []
        try:
            if file.filename.endswith(('.xlsx', '.xls')):
                # Save the file to a temporary in-memory file
                file_data = file.read()
                file.seek(0)  # Reset file pointer for future reads
                
                # Use pandas for both xlsx and xls files
                xls = pd.ExcelFile(io.BytesIO(file_data))
                all_sheet_names = xls.sheet_names
                
                # Known list of non-restaurant sheet names to filter out
                non_restaurant_sheets = {
                    'sheet1', 'sheet2', 'sheet3', 'sheet4', 'sheet5',
                    'index', 'data', 'info', 'summary', 'contents', 'cover'
                }
                
                # Filter out known non-restaurant sheets (case insensitive)
                self.sheet_restaurants = [
                    name for name in all_sheet_names 
                    if name.lower().strip() not in non_restaurant_sheets
                ]
                
                # Additional validation for known Excel structure
                # Sheet names with just numbers or special patterns are likely not restaurants
                self.sheet_restaurants = [
                    name for name in self.sheet_restaurants
                    if not name.strip().isdigit() and  # Exclude purely numeric names
                    not name.strip().startswith('_') and  # Exclude names starting with underscore
                    len(name.strip()) > 1  # Ensure name has more than 1 character
                ]
                
                # Sort alphabetically for consistent display
                self.sheet_restaurants.sort()
                
                logger.info(f"Extracted {len(self.sheet_restaurants)} restaurant names from sheets: {self.sheet_restaurants}")
                return self.sheet_restaurants
            return []
        except Exception as e:
            logger.error(f"Error extracting sheet restaurants with pandas: {str(e)}")
            logger.error(traceback.format_exc())
            return []

    def generate_metadata_network(self):
        """Generate network graph data from metadata relationships"""
        G = nx.Graph()
        
        # Process all debug metadata
        for debug in self.debug_data:
            if debug['debug_type'] == 'metadata':
                for item in debug['data']:
                    if ' -> ' in item:
                        category, value = item.split(' -> ')
                        G.add_node(category, type='category')
                        G.add_node(value, type='value')
                        G.add_edge(category, value)
        
        # Convert to format suitable for visualization
        nodes = [{'id': node, 'type': G.nodes[node]['type']} for node in G.nodes()]
        edges = [{'source': u, 'target': v} for u, v in G.edges()]
        
        return {'nodes': nodes, 'edges': edges}
    
    def get_persona_analysis_summary(self):
        """Generate summary statistics for persona analysis"""
        if not self.persona_analyzer:
            return {
                'persona_count': 0,
                'matched_conversations': 0,
                'avg_accuracy': 0,
                'avg_precision': 0,
                'avg_recall': 0,
                'accuracy_distribution': {},
                'recommendation_counts': {}
            }
            
        # Count matched conversations
        matched_conversations = 0
        accuracies = []
        precisions = []
        recalls = []
        recommendation_counts = defaultdict(int)
        
        for conversation in self.conversations:
            has_persona = any('persona_id' in msg for msg in conversation)
            if has_persona:
                matched_conversations += 1
                
                # Get accuracy if available
                for msg in conversation:
                    if msg['type'] == 'recommendation' and 'recommendation_evaluation' in msg:
                        eval_data = msg['recommendation_evaluation']
                        
                        # Add metrics
                        if 'accuracy' in eval_data:
                            accuracies.append(eval_data['accuracy'])
                        if 'precision' in eval_data:
                            precisions.append(eval_data['precision'])
                        if 'recall' in eval_data:
                            recalls.append(eval_data['recall'])
                        
                        # Count number of recommendations
                        actual_count = len(eval_data.get('actual_recommendations', []))
                        recommendation_counts[actual_count] += 1
        
        # Calculate averages
        avg_accuracy = sum(accuracies) / len(accuracies) if accuracies else 0
        avg_precision = sum(precisions) / len(precisions) if precisions else 0
        avg_recall = sum(recalls) / len(recalls) if recalls else 0
        
        # Create accuracy distribution
        accuracy_distribution = {
            '0-25%': len([a for a in accuracies if a <= 0.25]),
            '26-50%': len([a for a in accuracies if 0.25 < a <= 0.5]),
            '51-75%': len([a for a in accuracies if 0.5 < a <= 0.75]),
            '76-100%': len([a for a in accuracies if a > 0.75])
        }
        
        return {
            'persona_count': len(self.persona_analyzer.personas),
            'matched_conversations': matched_conversations,
            'avg_accuracy': avg_accuracy,
            'avg_precision': avg_precision,
            'avg_recall': avg_recall,
            'accuracy_distribution': accuracy_distribution,
            'recommendation_counts': dict(recommendation_counts)
        }

# Initialize the parser and debug analyzer 
parser = ConciergeParser()

# Import the DebugAnalyzer class
try:
    from debug_analyzer import DebugAnalyzer
    # Initialize a debug analyzer instance
    debug_analyzer = DebugAnalyzer()
    debug_analyzer_available = True
except ImportError:
    logger.warning("DebugAnalyzer module not found, debug analysis features will be disabled")
    debug_analyzer_available = False

@app.route('/dashboard')
def dashboard():
    """Route that renders the full dashboard application."""
    return render_template('index.html')

@app.route('/test', methods=['GET'])
def test():
    return jsonify({"status": "ok", "message": "Flask server is running", "environment": "PythonAnywhere" if PYTHONANYWHERE else "Local"})

@app.route('/upload', methods=['POST'])
def upload_chat():
    logger.info("Received upload request")
    
    if 'file' not in request.files:
        logger.warning("No file uploaded in request")
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        logger.warning("Empty filename in uploaded file")
        return jsonify({'error': 'Empty filename'}), 400
    
    try:
        logger.info(f"Processing uploaded file: {file.filename}")
        
        # Check file type and extract sheet names if it's an Excel file
        excel_file_processed = False
        if file.filename.endswith(('.xlsx', '.xls')):
            sheet_restaurants = parser.extract_sheet_restaurants(file)
            excel_file_processed = True
            # For Excel files, we need to convert the chat content to text
            # This assumes the chat is in the first sheet or you need to 
            # specify which sheet contains the chat content
            df = pd.read_excel(file)
            chat_text = df.to_csv(index=False)
        else:
            chat_text = file.read().decode('utf-8')
            
        logger.info(f"File decoded successfully, length: {len(chat_text)}")
        
        # Load persona data if not already loaded
        if not parser.persona_analyzer:
            # Updated path to use the BASE_DIR
            persona_csv_path = os.path.join(BASE_DIR, "Concierge - Personas.csv")
            parser.load_personas(persona_csv_path)
        
        conversations = parser.parse_whatsapp_chat(chat_text)
        logger.info(f"Parsed {len(conversations)} conversations")
        
        # Create a summary of conversations for PDF export
        conversation_summaries = []
        for i, conversation in enumerate(conversations):
            # Only include key information for the PDF summary
            summary = {
                'id': i,
                'request': next((msg['content'] for msg in conversation if msg['type'] == 'user_request'), 'No request'),
                'recommendation': next((msg['content'] for msg in conversation if msg['type'] == 'recommendation'), 'No recommendation'),
                'timestamp': next((msg['timestamp'].isoformat() for msg in conversation if msg['type'] == 'user_request'), None),
            }
            conversation_summaries.append(summary)
        
        metrics = parser.get_conversation_metrics()
        logger.info(f"Generated metrics for {len(metrics)} conversations")
        
        recommendations = parser.extract_restaurant_recommendations()
        logger.info(f"Extracted {len(recommendations)} recommendations")
        
        network_data = parser.generate_metadata_network()
        logger.info(f"Generated network with {len(network_data.get('nodes', []))} nodes and {len(network_data.get('edges', []))} edges")
        
        # Get persona analysis summary
        persona_summary = parser.get_persona_analysis_summary()
        logger.info(f"Generated persona analysis summary with {persona_summary.get('persona_count', 0)} personas")
        
        response_data = {
            'conversation_count': len(conversations),
            'metrics': metrics,
            'recommendations': recommendations,
            'network': network_data,
            'persona_summary': persona_summary,
            'conversation_summaries': conversation_summaries,  # Include summaries in the response
            'sheet_restaurants': parser.sheet_restaurants,  # Add sheet restaurants to the response
            'excel_file_processed': excel_file_processed  # Add flag to indicate Excel file was processed
        }
        
        # Verify the response can be serialized to JSON
        json_response = json.dumps(response_data)
        logger.info(f"Response JSON created successfully, length: {len(json_response)}")
        
        return jsonify(response_data)
    except Exception as e:
        logger.error(f"Error processing upload: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({'error': f"Server error: {str(e)}"}), 500

@app.route('/conversation/<int:conversation_id>')
def get_conversation(conversation_id):
    try:
        if conversation_id < 0 or conversation_id >= len(parser.conversations):
            logger.warning(f"Invalid conversation ID requested: {conversation_id}")
            return jsonify({'error': 'Invalid conversation ID'}), 404
        
        # Convert complex objects like datetime to string for JSON serialization
        conversation_data = []
        for msg in parser.conversations[conversation_id]:
            msg_copy = msg.copy()
            if 'timestamp' in msg_copy:
                msg_copy['timestamp'] = msg_copy['timestamp'].isoformat()
            conversation_data.append(msg_copy)
        
        return jsonify(conversation_data)
    except Exception as e:
        logger.error(f"Error getting conversation: {str(e)}")
        return jsonify({'error': f"Server error: {str(e)}"}), 500

@app.route('/metrics')
def get_metrics():
    try:
        return jsonify(parser.get_conversation_metrics())
    except Exception as e:
        logger.error(f"Error getting metrics: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/recommendations')
def get_recommendations():
    try:
        return jsonify(parser.extract_restaurant_recommendations())
    except Exception as e:
        logger.error(f"Error getting recommendations: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/network')
def get_network():
    try:
        return jsonify(parser.generate_metadata_network())
    except Exception as e:
        logger.error(f"Error generating network: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/personas')
def get_personas():
    try:
        if not parser.persona_analyzer:
            # Updated path to use BASE_DIR
            persona_csv_path = os.path.join(BASE_DIR, "Concierge - Personas.csv")
            parser.load_personas(persona_csv_path)
            
        return jsonify(parser.persona_analyzer.personas)
    except Exception as e:
        logger.error(f"Error getting personas: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/persona_summary')
def get_persona_summary():
    try:
        return jsonify(parser.get_persona_analysis_summary())
    except Exception as e:
        logger.error(f"Error getting persona summary: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/debug_analysis')
def get_debug_analysis():
    """Get comprehensive debug data analysis."""
    try:
        if not debug_analyzer_available:
            return jsonify({'error': 'Debug analyzer not available'}), 501
            
        # Make sure the debug analyzer has the latest conversations
        debug_analyzer.load_conversations(parser.conversations)
        
        # Generate global insights
        global_insights = debug_analyzer.generate_global_insights()
        
        # Get network data
        network_data = debug_analyzer.generate_network_data()
        
        # Get cross-recommendation insights
        cross_insights = debug_analyzer.get_cross_recommendations_insights()
        
        return jsonify({
            'global_insights': global_insights,
            'network_data': network_data,
            'cross_insights': cross_insights
        })
    except Exception as e:
        logger.error(f"Error generating debug analysis: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

@app.route('/debug_analysis/<int:conversation_id>')
def get_conversation_debug_analysis(conversation_id):
    """Get debug analysis for a specific conversation."""
    try:
        if not debug_analyzer_available:
            return jsonify({'error': 'Debug analyzer not available'}), 501
            
        # Get analysis for the specified conversation
        analysis = debug_analyzer.analyze_conversation_debug(conversation_id)
        return jsonify(analysis)
    except Exception as e:
        logger.error(f"Error generating conversation debug analysis: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

# Add a new endpoint to get sheet restaurants
@app.route('/sheet_restaurants')
def get_sheet_restaurants():
    try:
        # If we don't have sheet restaurants yet but we have a persona_analyzer
        # that might have restaurant data, try to extract known restaurant names
        if not parser.sheet_restaurants and parser.persona_analyzer:
            # Look for restaurant names in existing data
            known_restaurants = set()
            
            # Try to find restaurant names in recommendation evaluations
            for conversation in parser.conversations:
                for msg in conversation:
                    if msg.get('type') == 'recommendation' and 'recommendation_evaluation' in msg:
                        eval_data = msg.get('recommendation_evaluation', {})
                        if 'expected_recommendations' in eval_data:
                            for restaurant in eval_data['expected_recommendations']:
                                if restaurant and len(restaurant) > 2:  # Basic validation
                                    known_restaurants.add(restaurant)
            
            # If we found any restaurants, add them to sheet_restaurants
            if known_restaurants:
                parser.sheet_restaurants = list(known_restaurants)
                parser.sheet_restaurants.sort()
                logger.info(f"Added {len(parser.sheet_restaurants)} known restaurants from evaluation data")
        
        return jsonify(parser.sheet_restaurants)
    except Exception as e:
        logger.error(f"Error getting sheet restaurants: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/restaurants/batch', methods=['POST'])
def batch_insert_restaurants():
    """
    Batch insert restaurants endpoint.
    Accepts array of restaurant objects and returns server IDs for each.
    
    Dependencies: restaurants, curators, concepts, restaurant_concepts tables
    """
    try:
        data = request.get_json()
        if not isinstance(data, list):
            return jsonify({"status": "error", "message": "Expected a list of restaurants"}), 400

        conn = psycopg2.connect(
            host=os.environ.get("DB_HOST"),
            database=os.environ.get("DB_NAME"),
            user=os.environ.get("DB_USER"),
            password=os.environ.get("DB_PASSWORD")
        )
        cursor = conn.cursor()

        # Track results for each restaurant
        results = []

        for r in data:
            restaurant_name = r.get("name")
            local_id = r.get("id")  # Client-side local ID
            
            # Insert curator if doesn't exist
            curator_name = r.get("curator", {}).get("name", "Unknown")
            cursor.execute("""
                INSERT INTO curators (name)
                VALUES (%s)
                ON CONFLICT (name) DO NOTHING
            """, (curator_name,))
            
            # Get curator ID
            cursor.execute("SELECT id FROM curators WHERE name = %s", (curator_name,))
            curator_id = cursor.fetchone()[0]

            # Insert restaurant and get server ID
            cursor.execute("""
                INSERT INTO restaurants (name, description, transcription, timestamp, curator_id, server_id)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (name) DO UPDATE SET
                    description = EXCLUDED.description,
                    transcription = EXCLUDED.transcription,
                    timestamp = EXCLUDED.timestamp,
                    curator_id = EXCLUDED.curator_id
                RETURNING id
            """, (
                restaurant_name,
                r.get("description"),
                r.get("transcription"),
                r.get("timestamp"),
                curator_id,
                r.get("server_id")  # Include server_id for sync tracking
            ))

            # Get the server-assigned restaurant ID
            result = cursor.fetchone()
            server_id = result[0] if result else None
            
            if server_id:
                # Process concepts
                for c in r.get("concepts", []):
                    category = c.get("category")
                    value = c.get("value")
                    if not category or not value:
                        continue
                    
                    # Get category ID
                    cursor.execute("SELECT id FROM concept_categories WHERE name = %s", (category,))
                    result = cursor.fetchone()
                    if result:
                        category_id = result[0]
                    else:
                        continue  # skip unknown categories

                    # Insert concept if not exists
                    cursor.execute("""
                        INSERT INTO concepts (category_id, value)
                        VALUES (%s, %s)
                        ON CONFLICT (category_id, value) DO NOTHING
                    """, (category_id, value))

                    # Get concept ID
                    cursor.execute("""
                        SELECT id FROM concepts WHERE category_id = %s AND value = %s
                    """, (category_id, value))
                    concept_id = cursor.fetchone()[0]

                    # Insert restaurant_concept
                    cursor.execute("""
                        INSERT INTO restaurant_concepts (restaurant_id, concept_id)
                        VALUES (%s, %s)
                        ON CONFLICT (restaurant_id, concept_id) DO NOTHING
                    """, (server_id, concept_id))

                # Add to results with local ID mapping
                results.append({
                    "localId": local_id,
                    "serverId": server_id,
                    "name": restaurant_name,
                    "status": "success"
                })
            else:
                results.append({
                    "localId": local_id,
                    "name": restaurant_name,
                    "status": "error",
                    "message": "Failed to get server ID"
                })

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({
            "status": "success",
            "count": len(results),
            "restaurants": results
        }), 200

    except Exception as e:
        app.logger.error(f"Error in batch insert: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500



@app.route('/api/restaurants', methods=['GET'])
def get_all_restaurants():
    """
    Get all restaurants with their concepts and curator information.
    Enhanced with better error handling and database connection management.
    """
    conn = None
    cursor = None
    try:
        app.logger.info("Fetching all restaurants...")
        
        # Use the database connection helper
        conn = get_db_connection()
        cursor = conn.cursor()

        # Query restaurants with curator information
        cursor.execute("""
            SELECT r.id, r.name, r.description, r.transcription, r.timestamp, 
                   r.server_id, c.name as curator_name, c.id as curator_id
            FROM restaurants r
            LEFT JOIN curators c ON r.curator_id = c.id
            ORDER BY r.id DESC
        """)
        rows = cursor.fetchall()
        
        app.logger.info(f"Found {len(rows)} restaurants")

        restaurants = []
        for row in rows:
            r_id, name, description, transcription, timestamp, server_id, curator_name, curator_id = row

            # Fetch concepts for this restaurant
            cursor.execute("""
                SELECT cc.name, con.value
                FROM restaurant_concepts rc
                JOIN concepts con ON rc.concept_id = con.id
                JOIN concept_categories cc ON con.category_id = cc.id
                WHERE rc.restaurant_id = %s
                ORDER BY cc.name, con.value
            """, (r_id,))
            concept_rows = cursor.fetchall()
            concepts = [{'category': cat, 'value': val} for cat, val in concept_rows]

            restaurants.append({
                'id': r_id,
                'name': name,
                'description': description,
                'transcription': transcription,
                'timestamp': timestamp.isoformat() if timestamp else None,
                'server_id': server_id,
                'curator': {'id': curator_id, 'name': curator_name} if curator_id else None,
                'concepts': concepts
            })

        app.logger.info(f"Successfully formatted {len(restaurants)} restaurants")
        return jsonify(restaurants)
        
    except psycopg2.Error as e:
        app.logger.error(f"Database error fetching restaurants: {str(e)}")
        return jsonify({
            'status': 'error', 
            'message': 'Database connection error',
            'details': str(e)
        }), 500
    except Exception as e:
        app.logger.error(f"Unexpected error fetching restaurants: {str(e)}")
        return jsonify({
            'status': 'error', 
            'message': 'Internal server error',
            'details': str(e)
        }), 500
    finally:
        # Ensure database resources are cleaned up
        try:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
        except Exception as e:
            app.logger.error(f"Error closing database connection: {str(e)}")


# New endpoint: /api/restaurants-staging
# Handles GET (search/filter/pagination) and POST (create) operations

@app.route('/api/restaurants-staging', methods=['GET'])
def get_restaurants_staging():
    """
    GET endpoint for restaurants_staging table with filtering and pagination.
    
    Query Parameters:
    - Any column name from restaurants_staging table (e.g. name, address, country)
    - latitude, longitude, tolerance: For proximity search
    - page: Page number (default: 1)
    - per_page: Results per page (default: 20)
    
    Returns:
    - JSON with results, count, and search parameters
    
    Example:
    curl "https://<host>/api/restaurants-staging?name=King&country=China%20Mainland"
    curl "https://<host>/api/restaurants-staging?latitude=39.946681&longitude=116.410004&tolerance=0.001"
    """
    try:
        # Connect to database
        conn = psycopg2.connect(
            host=os.environ.get("DB_HOST"),
            database=os.environ.get("DB_NAME"),
            user=os.environ.get("DB_USER"),
            password=os.environ.get("DB_PASSWORD")
        )
        cursor = conn.cursor()
        
        # Get pagination parameters
        page = max(1, int(request.args.get('page', 1)))
        per_page = min(100, max(1, int(request.args.get('per_page', 20))))
        offset = (page - 1) * per_page
        
        # Extract query parameters (excluding pagination)
        query_params = {}
        geo_search = False
        for key, value in request.args.items():
            if key not in ['page', 'per_page']:
                if key in ['latitude', 'longitude', 'tolerance']:
                    # Handle special geo search parameters
                    if key in ['latitude', 'longitude']:
                        try:
                            query_params[key] = float(value)
                            geo_search = True
                        except ValueError:
                            return jsonify({
                                'status': 'error', 
                                'message': f"Invalid {key} value: must be a number"
                            }), 400
                    elif key == 'tolerance':
                        try:
                            query_params[key] = float(value)
                        except ValueError:
                            query_params[key] = 0.0005  # Default tolerance
                else:
                    # Regular query parameter
                    query_params[key] = value
        
        # If geo search is requested but missing parameters, return error
        if geo_search and ('latitude' not in query_params or 'longitude' not in query_params):
            return jsonify({
                'status': 'error', 
                'message': "Both latitude and longitude must be provided for geo search"
            }), 400
        
        # Set default tolerance if not provided
        if geo_search and 'tolerance' not in query_params:
            query_params['tolerance'] = 0.0005

        # Build the WHERE clause for filtering
        where_conditions = []
        query_values = []
        
        # Special handling for geo search
        if geo_search:
            where_conditions.append(
                "latitude BETWEEN %s AND %s AND longitude BETWEEN %s AND %s"
            )
            lat = query_params['latitude']
            lon = query_params['longitude']
            tol = query_params['tolerance']
            query_values.extend([lat - tol, lat + tol, lon - tol, lon + tol])
        
        # Regular field filters
        for key, value in query_params.items():
            if key not in ['latitude', 'longitude', 'tolerance']:
                where_conditions.append(f"{key} ILIKE %s")
                query_values.append(f"%{value}%")
        
        # Construct the SQL query
        count_sql = "SELECT COUNT(*) FROM restaurants_staging"
        query_sql = "SELECT * FROM restaurants_staging"
        
        if where_conditions:
            where_clause = " WHERE " + " AND ".join(where_conditions)
            count_sql += where_clause
            query_sql += where_clause
        
        # Add pagination
        query_sql += " ORDER BY id LIMIT %s OFFSET %s"
        query_values.extend([per_page, offset])
        
        # Execute count query
        cursor.execute(count_sql, query_values[:-2] if where_conditions else [])
        total_count = cursor.fetchone()[0]
        
        # Execute the main query
        cursor.execute(query_sql, query_values)
        rows = cursor.fetchall()
        
        # Get column names from cursor description
        columns = [desc[0] for desc in cursor.description]
        
        # Convert rows to dictionaries
        results = []
        for row in rows:
            result = {}
            for i, value in enumerate(row):
                # Convert datetime objects to ISO format for JSON serialization
                if isinstance(value, datetime):
                    value = value.isoformat()
                result[columns[i]] = value
            results.append(result)
        
        # Prepare response
        response = {
            'status': 'success',
            'count': total_count,
            'page': page,
            'per_page': per_page,
            'total_pages': (total_count + per_page - 1) // per_page,
            'search_params': {k: v for k, v in query_params.items() if k not in ['tolerance']},
            'results': results
        }
        
        cursor.close()
        conn.close()
        return jsonify(response)
    except Exception as e:
        app.logger.error(f"Error fetching restaurants staging: {str(e)}")
        app.logger.error(traceback.format_exc())
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/restaurants-staging', methods=['POST'])
def create_restaurant_staging():
    """
    POST endpoint to insert a new record into restaurants_staging table.
    
    Required fields:
    - name
    - address
    - country
    
    Returns:
    - JSON with status and created restaurant data
    
    Example:
    curl -X POST -H "Content-Type: application/json" -d '{
      "name": "Novo Restaurante",
      "address": "Rua Teste, 123",
      "country": "Brasil",
      "latitude": -23.5,
      "longitude": -46.6
    }' https://<host>/api/restaurants-staging
    """
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({
                'status': 'error', 
                'message': 'Content-Type must be application/json'
            }), 400
        
        # Get JSON data
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['name', 'address', 'country']
        missing_fields = [field for field in required_fields if field not in data]
        
        if missing_fields:
            return jsonify({
                'status': 'error',
                'message': f"Missing required fields: {', '.join(missing_fields)}"
            }), 400
        
        # Connect to database
        conn = psycopg2.connect(
            host=os.environ.get("DB_HOST"),
            database=os.environ.get("DB_NAME"),
            user=os.environ.get("DB_USER"),
            password=os.environ.get("DB_PASSWORD")
        )
        cursor = conn.cursor()
        
        # Get table columns to validate input fields
        cursor.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'restaurants_staging'
        """)
        valid_columns = [row[0] for row in cursor.fetchall()]
        
        # Filter data to include only valid columns
        filtered_data = {k: v for k, v in data.items() if k in valid_columns}
        
        # Build dynamic INSERT query
        columns = ', '.join(filtered_data.keys())
        placeholders = ', '.join(['%s'] * len(filtered_data))
        values = list(filtered_data.values())
        
        # Execute the query
        cursor.execute(f"""
            INSERT INTO restaurants_staging ({columns})
            VALUES ({placeholders})
            RETURNING *
        """, values)
        
        # Get the inserted row
        result = cursor.fetchone()
        
        # Convert to dictionary
        created_restaurant = {}
        for i, col in enumerate([desc[0] for desc in cursor.description]):
            # Convert datetime objects to ISO format for JSON serialization
            if isinstance(result[i], datetime):
                created_restaurant[col] = result[i].isoformat()
            else:
                created_restaurant[col] = result[i]
        
        # Commit the transaction
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({
            'status': 'success',
            'message': 'Restaurant created successfully',
            'restaurant': created_restaurant
        }), 201
    except Exception as e:
        app.logger.error(f"Error creating restaurant staging: {str(e)}")
        app.logger.error(traceback.format_exc())
        return jsonify({'status': 'error', 'message': str(e)}), 500

# Helper function to get available columns from restaurants_staging
def get_staging_columns():
    """
    Get a list of column names from the restaurants_staging table
    
    Returns:
        set: Set of column names
    """
    try:
        conn = psycopg2.connect(
            host=os.environ.get("DB_HOST"),
            database=os.environ.get("DB_NAME"),
            user=os.environ.get("DB_USER"),
            password=os.environ.get("DB_PASSWORD")
        )
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name='restaurants_staging'
        """)
        
        columns = {row[0] for row in cursor.fetchall()}
        
        cursor.close()
        conn.close()
        
        return columns
    except Exception as e:
        app.logger.error(f"Error fetching restaurant staging columns: {str(e)}")
        app.logger.error(traceback.format_exc())
        return set()

@app.route('/api/restaurants-staging/distinct/<field>', methods=['GET'])
def get_distinct_field(field):
    """
    Get distinct values for a specific field from restaurants_staging table
    
    Parameters:
        field (str): The column name to get distinct values from
    
    Returns:
        JSON array of distinct values, sorted alphabetically
    
    Example:
    curl "https://<host>/api/restaurants-staging/distinct/country"
    """
    try:
        # Verify that the field exists in the table
        allowed_fields = get_staging_columns()
        if not field or field not in allowed_fields:
            return jsonify({
                'status': 'error',
                'message': f"Invalid field '{field}'. Available fields: {', '.join(sorted(allowed_fields))}"
            }), 400
        
        # Connect to database
        conn = psycopg2.connect(
            host=os.environ.get("DB_HOST"),
            database=os.environ.get("DB_NAME"),
            user=os.environ.get("DB_USER"),
            password=os.environ.get("DB_PASSWORD")
        )
        cursor = conn.cursor()
        
        # Build and execute query using string formatting with column name validation
        # Since we already validated the field name against database columns, this is safe
        query = f"SELECT DISTINCT {field} FROM restaurants_staging WHERE {field} IS NOT NULL ORDER BY {field} ASC"
        cursor.execute(query)
        
        # Extract values from the result
        values = [row[0] for row in cursor.fetchall()]
        
        # Handle special cases for serialization
        serialized_values = []
        for value in values:
            # Convert datetime objects to ISO format for JSON serialization
            if isinstance(value, datetime):
                serialized_values.append(value.isoformat())
            else:
                serialized_values.append(value)
        
        cursor.close()
        conn.close()
        
        return jsonify({
            'status': 'success',
            'field': field,
            'count': len(serialized_values),
            'values': serialized_values
        })
    except Exception as e:
        app.logger.error(f"Error getting distinct values for field '{field}': {str(e)}")
        app.logger.error(traceback.format_exc())
        return jsonify({'status': 'error', 'message': str(e)}), 500


# ==========================================
# NEW SYNC ENDPOINTS FOR CRUD OPERATIONS
# ==========================================

@app.route('/api/restaurants/<int:restaurant_id>', methods=['GET'])
def get_restaurant(restaurant_id):
    """
    GET endpoint to fetch a specific restaurant by ID.
    
    Parameters:
        restaurant_id (int): The ID of the restaurant to fetch
    
    Returns:
        JSON with restaurant data including concepts
    
    Example:
    curl "https://<host>/api/restaurants/123"
    """
    try:
        conn = psycopg2.connect(
            host=os.environ.get("DB_HOST"),
            database=os.environ.get("DB_NAME"),
            user=os.environ.get("DB_USER"),
            password=os.environ.get("DB_PASSWORD")
        )
        cursor = conn.cursor()

        # Get restaurant basic info
        cursor.execute("""
            SELECT r.id, r.name, r.description, r.transcription, r.timestamp, 
                   r.server_id, c.name as curator_name, c.id as curator_id
            FROM restaurants r
            LEFT JOIN curators c ON r.curator_id = c.id
            WHERE r.id = %s
        """, (restaurant_id,))
        
        row = cursor.fetchone()
        if not row:
            cursor.close()
            conn.close()
            return jsonify({'status': 'error', 'message': 'Restaurant not found'}), 404

        r_id, name, description, transcription, timestamp, server_id, curator_name, curator_id = row

        # Fetch concepts
        cursor.execute("""
            SELECT cc.name, con.value
            FROM restaurant_concepts rc
            JOIN concepts con ON rc.concept_id = con.id
            JOIN concept_categories cc ON con.category_id = cc.id
            WHERE rc.restaurant_id = %s
        """, (restaurant_id,))
        concept_rows = cursor.fetchall()
        concepts = [{'category': cat, 'value': val} for cat, val in concept_rows]

        restaurant = {
            'id': r_id,
            'name': name,
            'description': description,
            'transcription': transcription,
            'timestamp': timestamp.isoformat() if timestamp else None,
            'server_id': server_id,
            'curator': {'id': curator_id, 'name': curator_name},
            'concepts': concepts
        }

        cursor.close()
        conn.close()

        return jsonify(restaurant)
    except Exception as e:
        app.logger.error(f"Error fetching restaurant {restaurant_id}: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/restaurants/<int:restaurant_id>', methods=['PUT'])
def update_restaurant(restaurant_id):
    """
    PUT endpoint to update an existing restaurant.
    
    Parameters:
        restaurant_id (int): The ID of the restaurant to update
    
    Request body should contain restaurant fields to update
    
    Returns:
        JSON with updated restaurant data
    
    Example:
    curl -X PUT -H "Content-Type: application/json" -d '{
      "name": "Updated Restaurant Name",
      "description": "Updated description"
    }' https://<host>/api/restaurants/123
    """
    try:
        if not request.is_json:
            return jsonify({'status': 'error', 'message': 'Content-Type must be application/json'}), 400
            
        data = request.get_json()
        
        conn = psycopg2.connect(
            host=os.environ.get("DB_HOST"),
            database=os.environ.get("DB_NAME"),
            user=os.environ.get("DB_USER"),
            password=os.environ.get("DB_PASSWORD")
        )
        cursor = conn.cursor()

        # Check if restaurant exists
        cursor.execute("SELECT id FROM restaurants WHERE id = %s", (restaurant_id,))
        if not cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({'status': 'error', 'message': 'Restaurant not found'}), 404

        # Build dynamic UPDATE query based on provided fields
        update_fields = []
        update_values = []
        
        allowed_fields = ['name', 'description', 'transcription', 'curator_id', 'server_id']
        for field in allowed_fields:
            if field in data:
                update_fields.append(f"{field} = %s")
                update_values.append(data[field])
        
        if not update_fields:
            cursor.close()
            conn.close()
            return jsonify({'status': 'error', 'message': 'No valid fields to update'}), 400
        
        # Add restaurant_id for WHERE clause
        update_values.append(restaurant_id)
        
        # Execute update
        update_query = f"UPDATE restaurants SET {', '.join(update_fields)} WHERE id = %s"
        cursor.execute(update_query, update_values)
        
        # Handle concepts update if provided
        if 'concepts' in data:
            # Delete existing concepts
            cursor.execute("DELETE FROM restaurant_concepts WHERE restaurant_id = %s", (restaurant_id,))
            
            # Insert new concepts
            for concept in data['concepts']:
                category = concept.get('category')
                value = concept.get('value')
                if not category or not value:
                    continue
                
                # Get or create category
                cursor.execute("""
                    INSERT INTO concept_categories (name)
                    VALUES (%s)
                    ON CONFLICT (name) DO NOTHING
                """, (category,))
                
                cursor.execute("SELECT id FROM concept_categories WHERE name = %s", (category,))
                category_id = cursor.fetchone()[0]
                
                # Get or create concept
                cursor.execute("""
                    INSERT INTO concepts (category_id, value)
                    VALUES (%s, %s)
                    ON CONFLICT (category_id, value) DO NOTHING
                """, (category_id, value))
                
                cursor.execute("""
                    SELECT id FROM concepts WHERE category_id = %s AND value = %s
                """, (category_id, value))
                concept_id = cursor.fetchone()[0]
                
                # Link to restaurant
                cursor.execute("""
                    INSERT INTO restaurant_concepts (restaurant_id, concept_id)
                    VALUES (%s, %s)
                    ON CONFLICT (restaurant_id, concept_id) DO NOTHING
                """, (restaurant_id, concept_id))

        conn.commit()
        cursor.close()
        conn.close()

        # Return updated restaurant
        return get_restaurant(restaurant_id)
        
    except Exception as e:
        app.logger.error(f"Error updating restaurant {restaurant_id}: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/restaurants/<int:restaurant_id>', methods=['DELETE'])
def delete_restaurant(restaurant_id):
    """
    DELETE endpoint to remove a restaurant and all its relationships.
    
    Parameters:
        restaurant_id (int): The ID of the restaurant to delete
    
    Returns:
        JSON with deletion status
    
    Example:
    curl -X DELETE https://<host>/api/restaurants/123
    """
    try:
        conn = psycopg2.connect(
            host=os.environ.get("DB_HOST"),
            database=os.environ.get("DB_NAME"),
            user=os.environ.get("DB_USER"),
            password=os.environ.get("DB_PASSWORD")
        )
        cursor = conn.cursor()

        # Check if restaurant exists
        cursor.execute("SELECT name FROM restaurants WHERE id = %s", (restaurant_id,))
        result = cursor.fetchone()
        if not result:
            cursor.close()
            conn.close()
            return jsonify({'status': 'error', 'message': 'Restaurant not found'}), 404
        
        restaurant_name = result[0]

        # Delete restaurant concepts (cascade)
        cursor.execute("DELETE FROM restaurant_concepts WHERE restaurant_id = %s", (restaurant_id,))
        concepts_deleted = cursor.rowcount
        
        # Delete restaurant
        cursor.execute("DELETE FROM restaurants WHERE id = %s", (restaurant_id,))
        
        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({
            'status': 'success',
            'message': f'Restaurant "{restaurant_name}" deleted successfully',
            'deleted_restaurant_id': restaurant_id,
            'deleted_concepts': concepts_deleted
        })
        
    except Exception as e:
        app.logger.error(f"Error deleting restaurant {restaurant_id}: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/restaurants/server-ids', methods=['GET'])
def get_restaurants_with_server_ids():
    """
    GET endpoint to fetch all restaurants with their server IDs for sync operations.
    
    Query Parameters:
        has_server_id: Filter by whether restaurant has server_id (true/false)
    
    Returns:
        JSON array of restaurants with id, name, and server_id fields
    
    Example:
    curl "https://<host>/api/restaurants/server-ids?has_server_id=false"
    """
    try:
        has_server_id = request.args.get('has_server_id')
        
        conn = psycopg2.connect(
            host=os.environ.get("DB_HOST"),
            database=os.environ.get("DB_NAME"),
            user=os.environ.get("DB_USER"),
            password=os.environ.get("DB_PASSWORD")
        )
        cursor = conn.cursor()

        # Build query based on server_id filter
        if has_server_id == 'true':
            query = "SELECT id, name, server_id FROM restaurants WHERE server_id IS NOT NULL ORDER BY id"
        elif has_server_id == 'false':
            query = "SELECT id, name, server_id FROM restaurants WHERE server_id IS NULL ORDER BY id"
        else:
            query = "SELECT id, name, server_id FROM restaurants ORDER BY id"
        
        cursor.execute(query)
        rows = cursor.fetchall()

        restaurants = []
        for row in rows:
            r_id, name, server_id = row
            restaurants.append({
                'id': r_id,
                'name': name,
                'server_id': server_id
            })

        cursor.close()
        conn.close()

        return jsonify({
            'status': 'success',
            'count': len(restaurants),
            'restaurants': restaurants
        })
        
    except Exception as e:
        app.logger.error(f"Error fetching restaurants with server IDs: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/restaurants/sync', methods=['POST'])
def sync_restaurants():
    """
    POST endpoint for bulk synchronization operations.
    Handles create, update, and delete operations in a single transaction.
    
    Request body format:
    {
        "create": [list of restaurant objects to create],
        "update": [list of restaurant objects with id to update],
        "delete": [list of restaurant IDs to delete]
    }
    
    Returns:
        JSON with sync results including created, updated, and deleted counts
    
    Example:
    curl -X POST -H "Content-Type: application/json" -d '{
      "create": [{"name": "New Restaurant", "description": "New description"}],
      "update": [{"id": 123, "name": "Updated Restaurant"}],
      "delete": [456, 789]
    }' https://<host>/api/restaurants/sync
    """
    try:
        if not request.is_json:
            return jsonify({'status': 'error', 'message': 'Content-Type must be application/json'}), 400
            
        data = request.get_json()
        
        conn = psycopg2.connect(
            host=os.environ.get("DB_HOST"),
            database=os.environ.get("DB_NAME"),
            user=os.environ.get("DB_USER"),
            password=os.environ.get("DB_PASSWORD")
        )
        cursor = conn.cursor()

        created_count = 0
        updated_count = 0
        deleted_count = 0
        errors = []

        try:
            # Handle deletions first
            if 'delete' in data and data['delete']:
                for restaurant_id in data['delete']:
                    try:
                        cursor.execute("DELETE FROM restaurant_concepts WHERE restaurant_id = %s", (restaurant_id,))
                        cursor.execute("DELETE FROM restaurants WHERE id = %s", (restaurant_id,))
                        if cursor.rowcount > 0:
                            deleted_count += 1
                    except Exception as e:
                        errors.append(f"Failed to delete restaurant {restaurant_id}: {str(e)}")

            # Handle updates
            if 'update' in data and data['update']:
                for restaurant in data['update']:
                    try:
                        restaurant_id = restaurant.get('id')
                        if not restaurant_id:
                            errors.append("Update operation missing 'id' field")
                            continue
                        
                        # Check if restaurant exists
                        cursor.execute("SELECT id FROM restaurants WHERE id = %s", (restaurant_id,))
                        if not cursor.fetchone():
                            errors.append(f"Restaurant {restaurant_id} not found for update")
                            continue
                        
                        # Build update query
                        update_fields = []
                        update_values = []
                        
                        allowed_fields = ['name', 'description', 'transcription', 'curator_id', 'server_id']
                        for field in allowed_fields:
                            if field in restaurant:
                                update_fields.append(f"{field} = %s")
                                update_values.append(restaurant[field])
                        
                        if update_fields:
                            update_values.append(restaurant_id)
                            update_query = f"UPDATE restaurants SET {', '.join(update_fields)} WHERE id = %s"
                            cursor.execute(update_query, update_values)
                            updated_count += 1
                        
                    except Exception as e:
                        errors.append(f"Failed to update restaurant {restaurant.get('id', 'unknown')}: {str(e)}")

            # Handle creations
            if 'create' in data and data['create']:
                for restaurant in data['create']:
                    try:
                        name = restaurant.get('name')
                        if not name:
                            errors.append("Create operation missing 'name' field")
                            continue
                        
                        # Insert restaurant
                        cursor.execute("""
                            INSERT INTO restaurants (name, description, transcription, timestamp, curator_id, server_id)
                            VALUES (%s, %s, %s, NOW(), %s, %s)
                            RETURNING id
                        """, (
                            name,
                            restaurant.get('description'),
                            restaurant.get('transcription'),
                            restaurant.get('curator_id'),
                            restaurant.get('server_id')
                        ))
                        
                        new_restaurant_id = cursor.fetchone()[0]
                        created_count += 1
                        
                        # Handle concepts if provided
                        if 'concepts' in restaurant:
                            for concept in restaurant['concepts']:
                                category = concept.get('category')
                                value = concept.get('value')
                                if not category or not value:
                                    continue
                                
                                # Get or create category
                                cursor.execute("""
                                    INSERT INTO concept_categories (name)
                                    VALUES (%s)
                                    ON CONFLICT (name) DO NOTHING
                                """, (category,))
                                
                                cursor.execute("SELECT id FROM concept_categories WHERE name = %s", (category,))
                                category_id = cursor.fetchone()[0]
                                
                                # Get or create concept
                                cursor.execute("""
                                    INSERT INTO concepts (category_id, value)
                                    VALUES (%s, %s)
                                    ON CONFLICT (category_id, value) DO NOTHING
                                """, (category_id, value))
                                
                                cursor.execute("""
                                    SELECT id FROM concepts WHERE category_id = %s AND value = %s
                                """, (category_id, value))
                                concept_id = cursor.fetchone()[0]
                                
                                # Link to restaurant
                                cursor.execute("""
                                    INSERT INTO restaurant_concepts (restaurant_id, concept_id)
                                    VALUES (%s, %s)
                                    ON CONFLICT (restaurant_id, concept_id) DO NOTHING
                                """, (new_restaurant_id, concept_id))
                        
                    except Exception as e:
                        errors.append(f"Failed to create restaurant {restaurant.get('name', 'unknown')}: {str(e)}")

            # Commit all changes
            conn.commit()
            
        except Exception as e:
            conn.rollback()
            raise e
        
        cursor.close()
        conn.close()

        return jsonify({
            'status': 'success',
            'results': {
                'created': created_count,
                'updated': updated_count,
                'deleted': deleted_count,
                'errors': errors
            }
        })
        
    except Exception as e:
        app.logger.error(f"Error in sync operation: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


# Global error handlers
@app.errorhandler(500)
def internal_server_error(error):
    """Handle 500 internal server errors with detailed logging."""
    app.logger.error(f"Internal server error: {str(error)}")
    return jsonify({
        'status': 'error',
        'message': 'Internal server error occurred',
        'timestamp': datetime.now().isoformat()
    }), 500

@app.errorhandler(404)
def not_found_error(error):
    """Handle 404 not found errors."""
    return jsonify({
        'status': 'error',
        'message': 'Resource not found',
        'timestamp': datetime.now().isoformat()
    }), 404

@app.errorhandler(400)
def bad_request_error(error):
    """Handle 400 bad request errors."""
    return jsonify({
        'status': 'error',
        'message': 'Bad request',
        'timestamp': datetime.now().isoformat()
    }), 400

@app.errorhandler(Exception)
def handle_unexpected_error(error):
    """Handle any unexpected errors that aren't caught elsewhere."""
    app.logger.error(f"Unexpected error: {str(error)}")
    app.logger.error(f"Error type: {type(error).__name__}")
    import traceback
    app.logger.error(f"Traceback: {traceback.format_exc()}")
    
    return jsonify({
        'status': 'error',
        'message': 'An unexpected error occurred',
        'error_type': type(error).__name__,
        'timestamp': datetime.now().isoformat()
    }), 500


# This block won't run when imported by the WSGI file on PythonAnywhere
# but will run when executing the script directly during development
if __name__ == "__main__":
    # Only run the server directly when not on PythonAnywhere
    if not PYTHONANYWHERE:
        logger.info("Starting Flask server on http://localhost:5000")
        app.run(host='0.0.0.0', port=5000, debug=True)
    else:
        logger.info("Running on PythonAnywhere - server will be started by WSGI")
