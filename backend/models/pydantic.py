"""Pydantic request/response models."""

from typing import List, Literal, Optional
from pydantic import BaseModel


class ChatMsg(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatIn(BaseModel):
    messages: Optional[List[ChatMsg]] = None
    message: Optional[str] = None
    model: Optional[str] = None  # Optional model override


class ClaimIn(BaseModel):
    invoiceId: str
