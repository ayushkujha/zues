"""Safe evaluator for advisory rule expressions (no eval/exec).

Supported syntax (a small subset of Python expressions):

    rain_mm[d1] > 10 or rain_mm[d2] > 10          index by lead day d1..dN
    max(tmax_c[d1:d3]) >= 38                        slices are INCLUSIVE: d1:d3 = 3 days
    22 <= mean(tmax_c[d1:d3]) <= 32                 chained comparisons
    stage in ["flowering", "maturity"]              membership on strings/lists
    any(rain_mm[d1:d5] >= 64.5)                     elementwise comparison + any/all
    date_of_max(rain_mm, d1, d3)                    returns a date label, for text params
    first_date_below(rain_mm, 2.5, d1, d5)          first date with value < threshold

Names: forecast variables, d1..dN, and extra context values (crop, stage).
"""

from __future__ import annotations

import ast
import string
from datetime import date
from functools import lru_cache
from typing import Any

import numpy as np


class ExprError(ValueError):
    pass


@lru_cache(maxsize=512)
def parse(expr: str) -> ast.Expression:
    try:
        tree = ast.parse(expr.strip(), mode="eval")
    except SyntaxError as e:
        raise ExprError(f"Syntax error in '{expr}': {e.msg}") from e
    _check(tree)
    return tree


_ALLOWED_NODES = (
    ast.Expression, ast.BoolOp, ast.And, ast.Or, ast.UnaryOp, ast.Not, ast.USub, ast.UAdd,
    ast.BinOp, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Compare, ast.Lt, ast.LtE, ast.Gt,
    ast.GtE, ast.Eq, ast.NotEq, ast.In, ast.NotIn, ast.Name, ast.Load, ast.Constant,
    ast.Subscript, ast.Slice, ast.Call, ast.List, ast.Tuple,
)


def _check(tree: ast.AST) -> None:
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODES):
            raise ExprError(f"Unsupported syntax: {type(node).__name__}")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in FUNCTIONS:
                raise ExprError("Only these functions are allowed: " + ", ".join(sorted(FUNCTIONS)))
            if node.keywords:
                raise ExprError("Keyword arguments are not allowed")
        if isinstance(node, ast.Name) and node.id.startswith("_"):
            raise ExprError(f"Invalid name '{node.id}'")


def _arr(x) -> np.ndarray:
    return np.atleast_1d(np.asarray(x, dtype=float))


FUNCTIONS = {
    "max": lambda ev, x: float(np.nanmax(_arr(x))),
    "min": lambda ev, x: float(np.nanmin(_arr(x))),
    "mean": lambda ev, x: float(np.nanmean(_arr(x))),
    "sum": lambda ev, x: float(np.nansum(_arr(x))),
    "any": lambda ev, x: bool(np.any(x)),
    "all": lambda ev, x: bool(np.all(x)),
    "count": lambda ev, x: int(np.sum(x)),
    "abs": lambda ev, x: np.abs(x),
    "date_of_max": lambda ev, s, a, b: ev.date_label(a + int(np.nanargmax(_arr(s)[a : b + 1]))),
    "first_date_below": lambda ev, s, thr, a, b: ev.first_date(_arr(s), thr, a, b, below=True),
    "first_date_above": lambda ev, s, thr, a, b: ev.first_date(_arr(s), thr, a, b, below=False),
}


class Evaluator:
    def __init__(
        self,
        series: dict[str, np.ndarray],
        dates: list[date],
        context: dict[str, Any] | None = None,
        date_format: str = "%d %b",
    ):
        self.series = {k: np.asarray(v, dtype=float) for k, v in series.items()}
        self.dates = list(dates)
        self.context = dict(context or {})
        self.date_format = date_format

    # -- helpers used by FUNCTIONS -------------------------------------------
    def date_label(self, i: int) -> str:
        return self.dates[i].strftime(self.date_format)

    def first_date(self, s: np.ndarray, thr: float, a: int, b: int, below: bool) -> str:
        seg = s[a : b + 1]
        hit = np.where(seg < thr if below else seg > thr)[0]
        return self.date_label(a + int(hit[0])) if len(hit) else ""

    # -- evaluation ------------------------------------------------------------
    def eval(self, expr: str) -> Any:
        return self._eval(parse(expr).body)

    def truthy(self, expr: str) -> bool:
        v = self.eval(expr)
        if isinstance(v, np.ndarray):
            if v.size != 1:
                raise ExprError(f"'{expr}' gives several values; wrap it in any(...) or all(...)")
            v = v.item()
        return bool(v)

    def _name(self, name: str) -> Any:
        if name in self.series:
            return self.series[name]
        if len(name) > 1 and name[0] == "d" and name[1:].isdigit():
            i = int(name[1:]) - 1
            if not 0 <= i < len(self.dates):
                raise ExprError(f"{name} is outside the forecast ({len(self.dates)} days)")
            return i
        if name in self.context:
            return self.context[name]
        if name in ("True", "False", "None"):
            return {"True": True, "False": False, "None": None}[name]
        raise ExprError(f"Unknown name '{name}'")

    def _eval(self, node: ast.AST) -> Any:
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            return self._name(node.id)
        if isinstance(node, (ast.List, ast.Tuple)):
            return [self._eval(e) for e in node.elts]
        if isinstance(node, ast.BoolOp):
            if isinstance(node.op, ast.And):
                for v in node.values:
                    if not self._scalar_bool(self._eval(v)):
                        return False
                return True
            for v in node.values:
                if self._scalar_bool(self._eval(v)):
                    return True
            return False
        if isinstance(node, ast.UnaryOp):
            v = self._eval(node.operand)
            if isinstance(node.op, ast.Not):
                return not self._scalar_bool(v)
            return -v if isinstance(node.op, ast.USub) else +v
        if isinstance(node, ast.BinOp):
            a, b = self._eval(node.left), self._eval(node.right)
            if isinstance(node.op, ast.Add):
                return a + b
            if isinstance(node.op, ast.Sub):
                return a - b
            if isinstance(node.op, ast.Mult):
                return a * b
            return np.divide(a, b) if np.any(b) else float("nan")
        if isinstance(node, ast.Compare):
            left = self._eval(node.left)
            result: Any = True
            for op, comp in zip(node.ops, node.comparators):
                right = self._eval(comp)
                r = self._compare(op, left, right)
                result = np.logical_and(result, r) if isinstance(r, np.ndarray) or isinstance(
                    result, np.ndarray
                ) else (result and r)
                left = right
            return result
        if isinstance(node, ast.Subscript):
            seq = self._eval(node.value)
            if not isinstance(seq, np.ndarray):
                raise ExprError("Only forecast variables can be indexed")
            sl = node.slice
            if isinstance(sl, ast.Slice):
                a = 0 if sl.lower is None else int(self._eval(sl.lower))
                b = len(seq) - 1 if sl.upper is None else int(self._eval(sl.upper))
                return seq[a : b + 1]
            return float(seq[int(self._eval(sl))])
        if isinstance(node, ast.Call):
            fn = FUNCTIONS[node.func.id]
            return fn(self, *[self._eval(a) for a in node.args])
        raise ExprError(f"Unsupported syntax: {type(node).__name__}")

    @staticmethod
    def _scalar_bool(v: Any) -> bool:
        if isinstance(v, np.ndarray):
            if v.size != 1:
                raise ExprError("and/or/not need single values; use any(...) or all(...)")
            return bool(v.item())
        return bool(v)

    @staticmethod
    def _compare(op: ast.cmpop, a: Any, b: Any) -> Any:
        if isinstance(op, ast.In):
            return a in b
        if isinstance(op, ast.NotIn):
            return a not in b
        if isinstance(op, ast.Lt):
            return a < b
        if isinstance(op, ast.LtE):
            return a <= b
        if isinstance(op, ast.Gt):
            return a > b
        if isinstance(op, ast.GtE):
            return a >= b
        if isinstance(op, ast.Eq):
            return a == b
        return a != b


class SafeFormatter(string.Formatter):
    """str.format without attribute or index access ({x.attr} / {x[0]} are rejected)."""

    def get_field(self, field_name, args, kwargs):
        if "." in field_name or "[" in field_name:
            raise ExprError(f"Invalid placeholder '{{{field_name}}}'")
        return super().get_field(field_name, args, kwargs)


def render(template: str, params: dict[str, Any]) -> str:
    return SafeFormatter().format(template, **params)
