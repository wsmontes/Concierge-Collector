"""
Shared slowapi Limiter instance.

Vive fora do main.py para que os routers possam importar o MESMO objeto
`limiter` sem criar import circular (main.py importa os routers; os routers
não podem importar de main.py). O main.py anexa esta instância ao
app.state.limiter e registra o handler/exception handler/middleware.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

# Rate limiter — keyed by client IP.
# Default limits (can be overridden per-endpoint with @limiter.limit):
#   - Read endpoints: 300 requests / minute
#   - Write/AI endpoints: 60 requests / minute
#   - Bulk endpoints: 20 requests / minute
# Endpoints protegidos por chave/pagamento ganham limites próprios no decorator.
limiter = Limiter(key_func=get_remote_address, default_limits=["300/minute"])
