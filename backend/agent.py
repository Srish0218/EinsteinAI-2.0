import ast
import operator

from langchain.agents import create_agent
from langchain.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI


@tool
def calculate(expression: str) -> str:
    """Evaluate basic arithmetic for numerical physics problems."""
    operations = {
        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.Pow: operator.pow,
        ast.USub: operator.neg,
        ast.UAdd: operator.pos,
    }

    def evaluate(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value

        if isinstance(node, ast.BinOp) and type(node.op) in operations:
            return operations[type(node.op)](evaluate(node.left), evaluate(node.right))

        if isinstance(node, ast.UnaryOp) and type(node.op) in operations:
            return operations[type(node.op)](evaluate(node.operand))

        raise ValueError("Only basic arithmetic is supported.")

    try:
        expression_tree = ast.parse(expression, mode="eval")
        return str(evaluate(expression_tree.body))
    except (SyntaxError, ValueError, ZeroDivisionError, OverflowError) as error:
        return f"Could not calculate that expression: {error}"


SYSTEM_PROMPT = """
You are EinsteinAI, a patient physics tutor created by Srishti Jaitly.

Answer physics questions only. If a question is unrelated to physics, politely
explain that you specialize in physics and invite the user to ask a physics question.

Explain concepts clearly, include units, and state assumptions. Use the calculate
tool for arithmetic instead of guessing. Adapt the explanation to the user's question.
"""


def answer_question(question: str, history: list[dict], api_key: str, show_steps: bool = False) -> dict[str, str | int]:
    model = ChatGoogleGenerativeAI(
        model="gemini-3.1-flash-lite",
        google_api_key=api_key,
        temperature=0.3,
    )

    system_prompt = SYSTEM_PROMPT
    if show_steps:
        system_prompt += "\nFor physics problems, show a clear step-by-step solution: list known values, choose the relevant principle or equation, substitute values with units, calculate, and state the result. For conceptual questions, keep the explanation clear and structured."

    agent = create_agent(
        model=model,
        tools=[calculate],
        system_prompt=system_prompt,
    )

    messages = history[-12:] + [
        {"role": "user", "content": question}
    ]

    result = agent.invoke({"messages": messages})
    final_message = result["messages"][-1]
    response = final_message.content

    if not isinstance(response, str):
        response = "\n".join(
            part.get("text", "")
            for part in response
            if isinstance(part, dict)
        )

    token_usage = getattr(final_message, "usage_metadata", None) or {}
    return {
        "answer": response,
        "input_tokens": int(token_usage.get("input_tokens", 0)),
        "output_tokens": int(token_usage.get("output_tokens", 0)),
    }
