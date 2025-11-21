import base64
import io

# Simulate what frontend sends
test_base64 = 'SGVsbG8gV29ybGQ='  # 'Hello World'

# Our fix
if isinstance(test_base64, str):
    audio_bytes = base64.b64decode(test_base64)
    audio_file = io.BytesIO(audio_bytes)
    audio_file.name = 'audio.m4a'
    print(f'✅ Type: {type(audio_file)}')
    print(f'✅ Has name: {hasattr(audio_file, "name")}')
    print(f'✅ Name value: {audio_file.name}')
    print(f'✅ Has read: {hasattr(audio_file, "read")}')
    print(f'✅ Content: {audio_file.read()}')
else:
    print('❌ Not a string')
