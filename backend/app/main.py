import fastapi
from .routers import health

app = fastapi.FastAPI()
app.include_router(health.router)