from abc import ABC, abstractmethod
from typing import Dict, Any, List

from pydantic import BaseModel

# Assuming PlanStep and ToolResult are defined in ../models.py
# If not, I may need to adjust the import path.
from ..models import PlanStep, ToolResult

class Tool(ABC):
    """
    Abstract base class for a pluggable tool that the agent can use.
    """
    @property
    @abstractmethod
    def name(self) -> str:
        """The name of the tool, as it should be called by the planner."""
        pass

    @abstractmethod
    async def execute(self, step: PlanStep) -> ToolResult:
        """
        Executes the tool's action.

        Args:
            step: The plan step containing the instructions for the tool.

        Returns:
            A ToolResult containing the output of the tool.
        """
        pass
