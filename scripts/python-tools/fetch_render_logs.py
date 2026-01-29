#!/usr/bin/env python3
"""
Fetch Render Logs via API

Purpose: Retrieve recent logs from Render.com production service
Usage: python scripts/fetch_render_logs.py

Requires: RENDER_API_KEY environment variable
Get your API key from: https://dashboard.render.com/account/settings
"""

import os
import sys
import requests
import json
from datetime import datetime, timedelta, timezone

# Render API configuration
RENDER_API_KEY = os.getenv("RENDER_API_KEY")
RENDER_SERVICE_ID = "srv-d4fngpjuibrs73bo70vg"  # From your Render dashboard URL
API_BASE_URL = "https://api.render.com/v1"


def list_all_services():
    """List all services in the account"""
    if not RENDER_API_KEY:
        print("❌ ERROR: RENDER_API_KEY not set")
        sys.exit(1)

    headers = {
        "Authorization": f"Bearer {RENDER_API_KEY}",
        "Accept": "application/json"
    }

    print("📋 Listing all services in your Render account...\n")
    print("="*80)
    
    services_url = f"{API_BASE_URL}/services"
    
    try:
        response = requests.get(services_url, headers=headers, params={"limit": 20})
        response.raise_for_status()
        
        data = response.json()
        
        # Handle both array and cursor-based responses
        if isinstance(data, list):
            services = data
        elif isinstance(data, dict):
            services = data.get('services', data.get('data', []))
        else:
            services = []
        
        if not services:
            print("⚠️ No services found")
            return
        
        for service in services:
            if isinstance(service, dict):
                print(f"\n📦 {service.get('name', 'Unknown')}")
                print(f"   ID: {service.get('id', 'N/A')}")
                print(f"   Type: {service.get('type', 'N/A')}")
                print(f"   Owner: {service.get('ownerId', 'N/A')}")
                print(f"   Region: {service.get('region', 'N/A')}")
                
                service_details = service.get('serviceDetails', {})
                if service_details:
                    print(f"   URL: {service_details.get('url', 'N/A')}")
        
        print("\n" + "="*80)
        print(f"✅ Found {len(services)} services")
        
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)



def fetch_logs(service_id, limit=500, minutes_ago=60):
    """
    Fetch logs from Render service using /logs endpoint
    
    Args:
        service_id: Render service ID
        limit: Number of log entries to fetch (max 10000)
        minutes_ago: How many minutes back to fetch logs
    """
    if not RENDER_API_KEY:
        print("❌ ERROR: RENDER_API_KEY not set")
        print("\nGet your API key from: https://dashboard.render.com/account/settings")
        print("Then run:")
        print("  export RENDER_API_KEY='your-key-here'")
        print("  python scripts/fetch_render_logs.py")
        sys.exit(1)

    headers = {
        "Authorization": f"Bearer {RENDER_API_KEY}",
        "Accept": "application/json"
    }

    # Get service details first
    print(f"📡 Fetching service info for: {service_id}")
    service_url = f"{API_BASE_URL}/services/{service_id}"
    
    owner_id = None
    try:
        response = requests.get(service_url, headers=headers)
        response.raise_for_status()
        service = response.json()
        
        owner_id = service.get('ownerId')
        
        print(f"✅ Service: {service.get('name', 'Unknown')}")
        print(f"   Type: {service.get('type', 'Unknown')}")
        print(f"   Region: {service.get('region', 'Unknown')}")
        print(f"   Owner ID: {owner_id}")
        print(f"   URL: {service.get('serviceDetails', {}).get('url', 'Unknown')}")
        print("\n" + "="*80 + "\n")
        
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 401:
            print("❌ ERROR: Invalid API key")
            print("   Get a new key from: https://dashboard.render.com/account/settings")
        elif e.response.status_code == 404:
            print(f"❌ ERROR: Service {service_id} not found")
            print("   Check the service ID in your Render dashboard")
        else:
            print(f"❌ ERROR: {e.response.status_code} - {e.response.text}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ ERROR: {e}")
        sys.exit(1)
    
    if not owner_id:
        print("❌ ERROR: Could not determine owner_id")
        sys.exit(1)

    # Calculate time range (ISO 8601 format)
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(minutes=minutes_ago)
    
    start_iso = start_time.isoformat()
    end_iso = end_time.isoformat()
    
    print(f"📋 Fetching logs from last {minutes_ago} minutes...")
    print(f"   Start: {start_time.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print(f"   End: {end_time.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print(f"   Limit: {limit} entries\n")
    print("="*80)
    print("📜 LOGS:")
    print("="*80 + "\n")
    
    # Fetch logs using /logs endpoint (requires ownerId and resource array)
    logs_url = f"{API_BASE_URL}/logs"
    params = {
        "ownerId": owner_id,
        "resource": [service_id],  # Must be array
        "startTime": start_iso,
        "endTime": end_iso,
        "limit": limit,
        "direction": "backward"
    }
    
    try:
        response = requests.get(logs_url, headers=headers, params=params)
        response.raise_for_status()
        
        data = response.json()
        logs = data.get('logs', [])
        
        if not logs:
            print("⚠️ No logs found in this time range")
            print(f"   Response keys: {list(data.keys())}")
            return
        
        log_count = 0
        for log_entry in logs:
            # Render API returns log objects with 'timestamp' and 'text' keys
            if isinstance(log_entry, dict):
                timestamp = log_entry.get('timestamp', '')
                text = log_entry.get('text', '').strip()
                
                # Parse timestamp for readable format
                if timestamp:
                    try:
                        dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                        time_str = dt.strftime('%H:%M:%S')
                    except:
                        time_str = timestamp[:8] if len(timestamp) > 8 else timestamp
                else:
                    time_str = '??:??:??'
                
                if text:  # Only print non-empty logs
                    print(f"[{time_str}] {text}")
                    log_count += 1
            elif isinstance(log_entry, str):
                # Simple string format
                if log_entry.strip():
                    print(log_entry)
                    log_count += 1
        
        print("\n" + "="*80)
        print(f"✅ Retrieved {log_count} log entries")
                
    except requests.exceptions.HTTPError as e:
        print(f"❌ ERROR: {e.response.status_code}")
        print(f"   Response: {e.response.text}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


def search_error_logs(service_id, keywords=None, minutes_ago=60):
    """
    Search for error logs containing specific keywords
    
    Args:
        service_id: Render service ID
        keywords: List of keywords to search for (default: errors)
        minutes_ago: How many minutes back to search
    """
    if keywords is None:
        keywords = ["ERROR", "error", "500", "Exception", "Traceback", "Failed", "orchestrate"]
    
    if not RENDER_API_KEY:
        print("❌ ERROR: RENDER_API_KEY not set")
        sys.exit(1)

    headers = {
        "Authorization": f"Bearer {RENDER_API_KEY}",
        "Accept": "application/json"
    }
    
    # Get service details to obtain owner_id
    service_url = f"{API_BASE_URL}/services/{service_id}"
    try:
        response = requests.get(service_url, headers=headers)
        response.raise_for_status()
        service = response.json()
        owner_id = service.get('ownerId')
        
        if not owner_id:
            print("❌ ERROR: Could not determine owner_id")
            sys.exit(1)
    except Exception as e:
        print(f"❌ ERROR getting service info: {e}")
        sys.exit(1)

    print(f"🔍 Searching for errors with keywords: {', '.join(keywords)}")
    print(f"   Time range: Last {minutes_ago} minutes")
    print("="*80 + "\n")

    # Calculate time range (ISO 8601 format)
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(minutes=minutes_ago)
    
    logs_url = f"{API_BASE_URL}/logs"
    params = {
        "ownerId": owner_id,
        "resource": [service_id],
        "startTime": start_time.isoformat(),
        "endTime": end_time.isoformat(),
    parser.add_argument("--list-services", action="store_true", help="List all services in account")
    
    args = parser.parse_args()

    print("🎯 Render Log Fetcher")
    print("="*80)
    print(f"Service ID: {args.service_id}")
    print(f"Timestamp: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print("="*80 + "\n")

    if args.list_services:
        list_all_services()
    el
        error_count = 0
        for log_entry in logs:
            if isinstance(log_entry, dict):
                text = log_entry.get('text', '').strip()
                if text and any(keyword in text for keyword in keywords):
                    timestamp = log_entry.get('timestamp', '')
                    
                    # Parse timestamp
                    if timestamp:
                        try:
                            dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                            time_str = dt.strftime('%Y-%m-%d %H:%M:%S')
                        except:
                            time_str = timestamp[:19] if len(timestamp) >= 19 else timestamp
                    else:
                        time_str = 'unknown'
                    
                    print(f"[{time_str}] {text}")
                    error_count += 1

        print("\n" + "="*80)
        print(f"✅ Found {error_count} error entries")

    except requests.exceptions.HTTPError as e:
        print(f"❌ ERROR: {e.response.status_code} - {e.response.reason}")
        try:
            error_detail = e.response.json()
            print(f"   Detail: {json.dumps(error_detail, indent=2)}")
        except:
            print(f"   Response: {e.response.text}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Fetch Render service logs")
    parser.add_argument("--service-id", default=RENDER_SERVICE_ID, help="Render service ID")
    parser.add_argument("--limit", type=int, default=500, help="Number of log entries")
    parser.add_argument("--minutes", type=int, default=60, help="How many minutes back to fetch logs")
    parser.add_argument("--errors-only", action="store_true", help="Show only error logs")
    parser.add_argument("--keywords", nargs="+", help="Search keywords")
    
    args = parser.parse_args()

    print("🎯 Render Log Fetcher")
    print("="*80)
    print(f"Service ID: {args.service_id}")
    print(f"Timestamp: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print("="*80 + "\n")

    if args.errors_only or args.keywords:
        keywords = args.keywords if args.keywords else None
        search_error_logs(args.service_id, keywords, args.minutes)
    else:
        fetch_logs(args.service_id, args.limit, args.minutes)
