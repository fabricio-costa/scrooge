"""Calculator module with type hints and dataclasses."""

from dataclasses import dataclass, field
from typing import List, Optional
from abc import ABC, abstractmethod
import math


@dataclass
class CalculatorConfig:
    """Configuration for calculator behavior."""
    precision: int = 2
    max_history: int = 100
    allowed_operations: List[str] = field(default_factory=lambda: ["+", "-", "*", "/"])


class BaseCalculator(ABC):
    """Abstract base calculator."""

    def __init__(self, config: Optional[CalculatorConfig] = None):
        self.config = config or CalculatorConfig()
        self.history: List[float] = []

    @abstractmethod
    def calculate(self, expression: str) -> float:
        """Calculate the result of an expression."""
        ...

    @property
    def last_result(self) -> Optional[float]:
        return self.history[-1] if self.history else None


class Calculator(BaseCalculator):
    """Full calculator implementation."""

    def calculate(self, expression: str) -> float:
        result = eval(expression)  # simplified for fixture
        self.history.append(result)
        return round(result, self.config.precision)

    def clear_history(self) -> None:
        self.history.clear()

    async def calculate_remote(self, expression: str) -> float:
        """Send calculation to remote service."""
        return self.calculate(expression)


def add(a: float, b: float) -> float:
    """Add two numbers."""
    return a + b


async def fetch_constants() -> dict:
    """Fetch mathematical constants from remote."""
    return {"pi": math.pi, "e": math.e}


class MathError(Exception):
    """Custom exception for math errors."""
    pass


PI = 3.14159
