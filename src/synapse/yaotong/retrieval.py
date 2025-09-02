# synapse/yaotong/retrieval.py
from typing import List, Dict, Any, Optional
from abc import ABC, abstractmethod
import asyncio
from .models.note import Note, NoteSearchResult, RetrievalContext

class NoteRetriever(ABC):
    """笔记检索器抽象基类"""
    
    @abstractmethod
    async def retrieve(self, query: str, k: int = 5, **kwargs) -> List[NoteSearchResult]:
        """检索相关笔记"""
        pass
    
    @abstractmethod
    async def multi_hop_retrieve(self, query: str, depth: int = 2, k: int = 5) -> RetrievalContext:
        """多跳检索，支持递归扩展"""
        pass

class LocalNoteRetriever(NoteRetriever):
    """本地笔记检索器实现"""
    
    def __init__(self, notes_db: Optional[List[Note]] = None):
        self.notes_db = notes_db or []
        
    async def retrieve(self, query: str, k: int = 5, **kwargs) -> List[NoteSearchResult]:
        """基于关键词的简单检索实现"""
        if not self.notes_db:
            # 返回模拟数据用于测试
            return [
                NoteSearchResult(
                    note=Note(id="demo-1", title="Demo Note 1", content="This is demo content about " + query),
                    score=0.91
                ),
                NoteSearchResult(
                    note=Note(id="demo-2", title="Demo Note 2", content="Another demo note related to " + query),
                    score=0.87
                )
            ]
        
        # 简单的关键词匹配
        results = []
        query_lower = query.lower()
        
        for note in self.notes_db:
            score = 0.0
            # 标题匹配权重更高
            if query_lower in note.title.lower():
                score += 0.5
            # 内容匹配
            if query_lower in note.content.lower():
                score += 0.3
                
            if score > 0:
                results.append(NoteSearchResult(note=note, score=score))
        
        # 按分数排序并返回前k个
        results.sort(key=lambda x: x.score, reverse=True)
        return results[:k]
    
    async def multi_hop_retrieve(self, query: str, depth: int = 2, k: int = 5) -> RetrievalContext:
        """多跳检索实现"""
        all_results = []
        current_queries = [query]
        
        for hop in range(depth):
            hop_results = []
            for q in current_queries:
                results = await self.retrieve(q, k=k)
                hop_results.extend(results)
            
            if not hop_results:
                break
                
            all_results.extend(hop_results)
            
            # 为下一跳生成新查询（从当前结果的标题中提取关键词）
            if hop < depth - 1:
                current_queries = []
                for result in hop_results[:3]:  # 只从前3个结果生成新查询
                    # 简单提取标题作为新查询
                    current_queries.append(result.note.title)
        
        # 去重并按分数排序
        unique_results = {}
        for result in all_results:
            if result.note.id not in unique_results or result.score > unique_results[result.note.id].score:
                unique_results[result.note.id] = result
        
        final_results = list(unique_results.values())
        final_results.sort(key=lambda x: x.score, reverse=True)
        
        return RetrievalContext(
            query=query,
            results=final_results[:k],
            total_found=len(final_results),
            search_depth=depth
        )

# 工厂函数
def create_retriever(retriever_type: str = "local", **kwargs) -> NoteRetriever:
    """创建检索器实例"""
    if retriever_type == "local":
        return LocalNoteRetriever(**kwargs)
    else:
        raise ValueError(f"Unknown retriever type: {retriever_type}")

if __name__ == "__main__":
    # 测试代码
    async def test_retriever():
        retriever = create_retriever("local")
        results = await retriever.retrieve("test query", k=2)
        print(f"Found {len(results)} results")
        for result in results:
            print(f"- {result.note.title} (score: {result.score})")
    
    asyncio.run(test_retriever())