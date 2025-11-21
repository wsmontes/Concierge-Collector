"""
File: test_places_fields.py
Purpose: Test Google Places API field masks to ensure all fields are valid
Dependencies: pytest, httpx
Last Updated: November 21, 2025

This test validates that all fields in our field masks are accepted by Google Places API.
It helps catch field name changes or deprecations early.
"""
import pytest
import httpx
from app.api.places import get_enhanced_field_mask


class TestPlacesFieldMasks:
    """Test field mask generation and validation"""
    
    def test_minimal_field_mask_no_prefix(self):
        """Test minimal field mask without prefix (for Place Details)"""
        mask = get_enhanced_field_mask(
            include_reviews=False,
            include_photos=False,
            detail_level="minimal",
            use_prefix=False
        )
        
        # Should contain essential fields only
        assert "id" in mask
        assert "displayName" in mask
        assert "formattedAddress" in mask
        assert "location" in mask
        assert "rating" in mask
        assert "userRatingCount" in mask
        assert "priceLevel" in mask
        assert "types" in mask
        assert "businessStatus" in mask
        
        # Should NOT contain prefix
        assert "places.id" not in mask
    
    def test_minimal_field_mask_with_prefix(self):
        """Test minimal field mask with prefix (for searchNearby/searchText)"""
        mask = get_enhanced_field_mask(
            include_reviews=False,
            include_photos=False,
            detail_level="minimal",
            use_prefix=True
        )
        
        # Should contain places. prefix
        assert "places.id" in mask
        assert "places.displayName" in mask
        assert "places.formattedAddress" in mask
    
    def test_standard_field_mask_structure(self):
        """Test standard field mask contains all expected categories"""
        mask = get_enhanced_field_mask(
            include_reviews=False,
            include_photos=True,
            detail_level="standard",
            use_prefix=False
        )
        
        # Essential fields
        assert "id" in mask
        assert "displayName" in mask
        
        # Contact fields
        assert "websiteUri" in mask
        assert "internationalPhoneNumber" in mask
        
        # Hours
        assert "currentOpeningHours" in mask
        assert "regularOpeningHours" in mask
        
        # Address
        assert "shortFormattedAddress" in mask
        assert "addressComponents" in mask
        
        # Attributes
        assert "takeout" in mask
        assert "delivery" in mask
        assert "dineIn" in mask
        
        # Photos
        assert "photos" in mask
        
        # Should NOT contain reviews (not requested)
        assert "reviews" not in mask
    
    def test_full_field_mask_structure(self):
        """Test full field mask contains all categories"""
        mask = get_enhanced_field_mask(
            include_reviews=True,
            include_photos=True,
            detail_level="full",
            use_prefix=False
        )
        
        # Essential fields
        assert "id" in mask
        
        # Food service
        assert "servesBreakfast" in mask
        assert "servesLunch" in mask
        assert "servesDinner" in mask
        assert "servesBrunch" in mask
        
        # Dietary
        assert "servesVegetarianFood" in mask
        
        # Amenities (using new field name)
        assert "accessibilityOptions" in mask
        assert "outdoorSeating" in mask
        assert "goodForChildren" in mask
        
        # Parking & Payment
        assert "parkingOptions" in mask
        assert "paymentOptions" in mask
        
        # Metadata
        assert "googleMapsUri" in mask
        
        # Reviews (requested)
        assert "reviews" in mask
        
        # Photos (requested)
        assert "photos" in mask
        
        # Deprecated fields should NOT be present
        assert "wheelchairAccessibleEntrance" not in mask
        assert "iconMaskBaseUri" not in mask
        assert "attributions" not in mask
    
    def test_field_mask_no_duplicates(self):
        """Ensure field masks don't contain duplicate fields"""
        for detail_level in ["minimal", "standard", "full"]:
            for use_prefix in [True, False]:
                mask = get_enhanced_field_mask(
                    include_reviews=True,
                    include_photos=True,
                    detail_level=detail_level,
                    use_prefix=use_prefix
                )
                
                fields = mask.split(",")
                unique_fields = set(fields)
                
                assert len(fields) == len(unique_fields), \
                    f"Duplicate fields found in {detail_level} mask with prefix={use_prefix}"


class TestPlacesFieldValidation:
    """Test field masks against actual Google Places API"""
    
    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_minimal_fields_nearby_search(self, test_google_api_key, request):
        """Test minimal field mask with actual Google Places API (searchNearby)"""
        if not test_google_api_key:
            pytest.skip("No Google API key configured")
        
        field_mask = get_enhanced_field_mask(
            include_reviews=False,
            include_photos=False,
            detail_level="minimal",
            use_prefix=True
        )
        
        payload = {
            "maxResultCount": 1,
            "locationRestriction": {
                "circle": {
                    "center": {
                        "latitude": -23.5505,
                        "longitude": -46.6333
                    },
                    "radius": 1000
                }
            }
        }
        
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": test_google_api_key,
            "X-Goog-FieldMask": field_mask
        }
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                "https://places.googleapis.com/v1/places:searchNearby",
                json=payload,
                headers=headers
            )
            
            # Should succeed or fail with specific errors (not field validation error)
            assert response.status_code != 400, \
                f"Field validation error: {response.text}"
    
    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_standard_fields_nearby_search(self, test_google_api_key, request):
        """Test standard field mask with actual Google Places API"""
        if not test_google_api_key:
            pytest.skip("No Google API key configured")
        
        field_mask = get_enhanced_field_mask(
            include_reviews=False,
            include_photos=True,
            detail_level="standard",
            use_prefix=True
        )
        
        payload = {
            "maxResultCount": 1,
            "locationRestriction": {
                "circle": {
                    "center": {
                        "latitude": -23.5505,
                        "longitude": -46.6333
                    },
                    "radius": 1000
                }
            }
        }
        
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": test_google_api_key,
            "X-Goog-FieldMask": field_mask
        }
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                "https://places.googleapis.com/v1/places:searchNearby",
                json=payload,
                headers=headers
            )
            
            # Should succeed or fail with specific errors (not field validation error)
            assert response.status_code != 400, \
                f"Field validation error: {response.text}"
            
            if response.status_code == 200:
                data = response.json()
                assert "places" in data
    
    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_full_fields_place_details(self, test_google_api_key, test_place_id, request):
        """Test full field mask with Place Details API"""
        if not test_google_api_key or not test_place_id:
            pytest.skip("No Google API key or test place ID configured")
        
        field_mask = get_enhanced_field_mask(
            include_reviews=True,
            include_photos=True,
            detail_level="full",
            use_prefix=False  # Place Details doesn't use prefix
        )
        
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": test_google_api_key,
            "X-Goog-FieldMask": field_mask
        }
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"https://places.googleapis.com/v1/places/{test_place_id}",
                headers=headers
            )
            
            # Should succeed or fail with specific errors (not field validation error)
            assert response.status_code != 400, \
                f"Field validation error: {response.text}"


class TestDeprecatedFields:
    """Test that deprecated fields are not in our field masks"""
    
    def test_no_deprecated_fields(self):
        """Ensure deprecated fields are not present in any configuration"""
        deprecated_fields = [
            "wheelchairAccessibleEntrance",  # Replaced with accessibilityOptions
            "iconMaskBaseUri",  # Deprecated in Places API (New)
            "attributions",  # Not valid in Places API (New)
            "url",  # Replaced with googleMapsUri
            "icon",  # Deprecated
            "scope"  # Deprecated
        ]
        
        for detail_level in ["minimal", "standard", "full"]:
            for use_prefix in [True, False]:
                mask = get_enhanced_field_mask(
                    include_reviews=True,
                    include_photos=True,
                    detail_level=detail_level,
                    use_prefix=use_prefix
                )
                
                for deprecated in deprecated_fields:
                    # Check both with and without prefix
                    assert deprecated not in mask, \
                        f"Deprecated field '{deprecated}' found in {detail_level} mask"
                    assert f"places.{deprecated}" not in mask, \
                        f"Deprecated field 'places.{deprecated}' found in {detail_level} mask"


class TestFieldMaskCoverage:
    """Test that field masks cover all important use cases"""
    
    def test_essential_fields_always_present(self):
        """Test that essential fields are in all configurations"""
        essential_fields = ["id", "displayName", "formattedAddress", "location", "rating"]
        
        for detail_level in ["minimal", "standard", "full"]:
            mask = get_enhanced_field_mask(
                include_reviews=False,
                include_photos=False,
                detail_level=detail_level,
                use_prefix=False
            )
            
            for field in essential_fields:
                assert field in mask, \
                    f"Essential field '{field}' missing from {detail_level} mask"
    
    def test_restaurant_specific_fields_in_full(self):
        """Test that restaurant-specific fields are in full detail level"""
        restaurant_fields = [
            "servesBreakfast",
            "servesLunch", 
            "servesDinner",
            "servesBrunch",
            "servesBeer",
            "servesWine",
            "servesVegetarianFood"
        ]
        
        mask = get_enhanced_field_mask(
            include_reviews=False,
            include_photos=False,
            detail_level="full",
            use_prefix=False
        )
        
        for field in restaurant_fields:
            assert field in mask, \
                f"Restaurant field '{field}' missing from full mask"
    
    def test_contact_fields_in_standard_and_full(self):
        """Test that contact fields are in standard and full levels"""
        contact_fields = [
            "websiteUri",
            "internationalPhoneNumber",
            "nationalPhoneNumber"
        ]
        
        for detail_level in ["standard", "full"]:
            mask = get_enhanced_field_mask(
                include_reviews=False,
                include_photos=False,
                detail_level=detail_level,
                use_prefix=False
            )
            
            for field in contact_fields:
                assert field in mask, \
                    f"Contact field '{field}' missing from {detail_level} mask"
    
    def test_reviews_only_when_requested(self):
        """Test that reviews field is only present when explicitly requested"""
        # Without reviews
        mask_no_reviews = get_enhanced_field_mask(
            include_reviews=False,
            include_photos=False,
            detail_level="full",
            use_prefix=False
        )
        assert "reviews" not in mask_no_reviews
        
        # With reviews
        mask_with_reviews = get_enhanced_field_mask(
            include_reviews=True,
            include_photos=False,
            detail_level="full",
            use_prefix=False
        )
        assert "reviews" in mask_with_reviews
    
    def test_photos_only_when_requested(self):
        """Test that photos field is only present when explicitly requested"""
        # Without photos
        mask_no_photos = get_enhanced_field_mask(
            include_reviews=False,
            include_photos=False,
            detail_level="standard",
            use_prefix=False
        )
        assert "photos" not in mask_no_photos
        
        # With photos
        mask_with_photos = get_enhanced_field_mask(
            include_reviews=False,
            include_photos=True,
            detail_level="standard",
            use_prefix=False
        )
        assert "photos" in mask_with_photos
