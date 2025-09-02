# synapse/yaotong/models/note.py
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional, List
from datetime import datetime

class Note(BaseModel):
    """笔记数据模型"""
    id: str
    title: str
    content: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    def get_preview(self, max_length: int = 200) -> str:
        """获取内容预览"""
        if len(self.content) <= max_length:
            return self.content
        return self.content[:max_length] + "..."

class NoteSearchResult(BaseModel):
    """笔记搜索结果"""
    note: Note
    score: float
    matched_chunks: List[str] = Field(default_factory=list)
    
class RetrievalContext(BaseModel):
    """检索上下文"""
    query: str
    results: List[NoteSearchResult]
    total_found: int
    search_depth: int = 1
    metadata: Dict[str, Any] = Field(default_factory=dict)