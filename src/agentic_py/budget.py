from pydantic import BaseModel
from typing import Literal, Dict

Tier = Literal['free', 'pro']

class AgentBudget(BaseModel):
    maxSteps: int
    maxToolCalls: int
    contextCapChars: int
    tempPlan: float

AGENT_BUDGET: Dict[Tier, AgentBudget] = {
    'free': AgentBudget(maxSteps=0, maxToolCalls=0, contextCapChars=3200, tempPlan=0.2),
    'pro':  AgentBudget(maxSteps=4, maxToolCalls=6, contextCapChars=5200, tempPlan=0.4),
}
