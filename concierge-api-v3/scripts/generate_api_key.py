#!/usr/bin/env python3
"""
Generate secure API keys for authentication.

Usage:
    python scripts/generate_api_key.py
    python scripts/generate_api_key.py --count 5
"""

import secrets
import argparse
from typing import List


def generate_api_key() -> str:
    """
    Generate a secure random API key.
    
    Uses secrets.token_urlsafe which generates a URL-safe 
    base64-encoded random string with 256 bits of entropy.
    
    Returns:
        str: Secure random API key
    """
    return secrets.token_urlsafe(32)


def generate_multiple_keys(count: int) -> List[str]:
    """
    Generate multiple API keys.
    
    Args:
        count: Number of keys to generate
        
    Returns:
        List[str]: List of secure random API keys
    """
    return [generate_api_key() for _ in range(count)]


def main():
    """Main CLI entry point"""
    parser = argparse.ArgumentParser(
        description="Generate secure API keys for authentication",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate one key
  python scripts/generate_api_key.py
  
  # Generate 5 keys
  python scripts/generate_api_key.py --count 5
  
  # Save to .env file (manually)
  echo "API_SECRET_KEY=$(python scripts/generate_api_key.py)" >> .env
        """
    )
    
    parser.add_argument(
        '-c', '--count',
        type=int,
        default=1,
        help='Number of keys to generate (default: 1)'
    )
    
    parser.add_argument(
        '-q', '--quiet',
        action='store_true',
        help='Only output the keys, no labels'
    )
    
    args = parser.parse_args()
    
    if args.count < 1:
        parser.error("Count must be at least 1")
    
    keys = generate_multiple_keys(args.count)
    
    if args.quiet:
        for key in keys:
            print(key)
    else:
        print("=" * 70)
        print("🔐 SECURE API KEY GENERATOR")
        print("=" * 70)
        print()
        
        if args.count == 1:
            print("Generated API Key:")
            print("-" * 70)
            print(keys[0])
            print()
            print("Add to your .env file:")
            print(f"API_SECRET_KEY={keys[0]}")
        else:
            print(f"Generated {args.count} API Keys:")
            print("-" * 70)
            for i, key in enumerate(keys, 1):
                print(f"{i}. {key}")
        
        print()
        print("⚠️  SECURITY NOTES:")
        print("  - Keep these keys SECRET - never commit to git")
        print("  - Store in .env file (already in .gitignore)")
        print("  - Use different keys for dev/staging/production")
        print("  - Rotate keys periodically")
        print("=" * 70)


if __name__ == "__main__":
    main()
