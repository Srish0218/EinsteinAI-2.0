import logging
import time
from functools import lru_cache

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from supabase import create_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("einsteinai.api")

from agent import answer_question


class Settings(BaseSettings):
    gemini_api_key: str
    supabase_url: str | None = None
    supabase_publishable_key: str | None = None
    supabase_anon_key: str | None = None
    supabase_service_role_key: str | None = None
    # Vite uses 5173 by default and may fall back to 5174 when that port is busy.
    cors_origins: str = "http://localhost:5173,http://localhost:5174"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def settings():
    return Settings()


config = settings()
app = FastAPI(title="EinsteinAI API", version="1.0.0")
logger.info(
    "API configuration loaded: Supabase URL=%s, publishable key=%s, server key=%s",
    bool(config.supabase_url),
    bool(config.supabase_publishable_key or config.supabase_anon_key),
    bool(config.supabase_service_role_key),
)

allowed_origins = {origin.strip() for origin in config.cors_origins.split(",") if origin.strip()}
# Always allow Vite's two local development ports, even if backend/.env lists one.
allowed_origins.update({"http://localhost:5173", "http://localhost:5174"})

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(allowed_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def request_log(request, call_next):
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("Unhandled request error: %s %s", request.method, request.url.path)
        raise
    elapsed_ms = (time.perf_counter() - started) * 1000
    logger.info("%s %s -> %s (%.0f ms)", request.method, request.url.path, response.status_code, elapsed_ms)
    return response


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=12000)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=12)
    show_steps: bool = False


@app.get("/health")
def health():
    return {"status": "ok"}


def get_user_database(authorization: str | None):
    if not authorization or not authorization.lower().startswith("bearer "):
        logger.warning("Request rejected: missing bearer token")
        raise HTTPException(status_code=401, detail="Sign in to use the physics assistant.")

    public_key = config.supabase_publishable_key or config.supabase_anon_key
    if not config.supabase_url or not public_key or not config.supabase_service_role_key:
        logger.error("Supabase credentials are missing from backend/.env")
        raise HTTPException(
            status_code=503,
            detail="Add SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY to backend/.env.",
        )

    token = authorization.split(" ", 1)[1].strip()
    auth_client = create_client(config.supabase_url, public_key)
    try:
        user_response = auth_client.auth.get_user(token)
        if not user_response.user:
            raise HTTPException(status_code=401, detail="Your session expired. Please sign in again.")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Supabase rejected a user session (%s)", type(exc).__name__)
        raise HTTPException(status_code=401, detail="Your session is invalid. Please sign in again.") from exc

    # Only this server-side client has the service-role key; it is never sent to React.
    client = create_client(config.supabase_url, config.supabase_service_role_key)
    return client, user_response.user


@app.get("/api/usage")
def usage(authorization: str | None = Header(default=None)):
    client, user = get_user_database(authorization)
    try:
        result = (
            client.table("account_usage")
            .select("questions_used,question_credits,input_tokens,output_tokens,subscription_status,subscription_ends_at,created_at,updated_at")
            .eq("user_id", str(user.id))
            .single()
            .execute()
        )
        return result.data
    except Exception as exc:
        logger.exception("Usage lookup failed for authenticated user id=%s", user.id)
        raise HTTPException(status_code=500, detail="Could not load your usage. Check the backend terminal logs.") from exc


@app.post("/api/chat")
def chat(body: ChatRequest, authorization: str | None = Header(default=None)):
    client, _user = get_user_database(authorization)
    consumed_credit = False
    try:
        quota = client.rpc("consume_question", {"p_user_id": str(_user.id)}).execute().data
        if not quota.get("allowed"):
            raise HTTPException(
                status_code=402,
                detail="You have used your free questions and question credits. Choose a plan in your profile to continue.",
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Question allowance lookup failed for authenticated user id=%s", _user.id)
        raise HTTPException(status_code=500, detail="Could not check your question allowance. Check the backend terminal logs.") from exc

    try:
        consumed_credit = bool(quota.get("used_credit", False))
        result = answer_question(
            body.question,
            [message.model_dump() for message in body.history],
            config.gemini_api_key,
            show_steps=body.show_steps,
        )
        try:
            client.rpc(
                "record_token_usage",
                {
                    "p_user_id": str(_user.id),
                    "p_input_tokens": result["input_tokens"],
                    "p_output_tokens": result["output_tokens"],
                },
            ).execute()
        except Exception:
            # Do not discard a successful answer if Gemini's usage stats cannot be saved.
            pass

        return {
            "answer": result["answer"],
            "input_tokens": result["input_tokens"],
            "output_tokens": result["output_tokens"],
            "questions_used": quota["questions_used"],
            "questions_remaining": quota["questions_remaining"],
            "subscription_status": quota["subscription_status"],
        }
    except Exception as exc:
        logger.exception("Assistant generation failed for authenticated user id=%s", _user.id)
        try:
            client.rpc("refund_question", {"p_user_id": str(_user.id), "p_used_credit": consumed_credit}).execute()
        except Exception:
            pass
        raise HTTPException(status_code=502, detail="The physics assistant is temporarily unavailable.") from exc
