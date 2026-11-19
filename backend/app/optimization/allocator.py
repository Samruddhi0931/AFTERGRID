from collections import defaultdict
from typing import Any

from ortools.sat.python import cp_model

from app.database import EmergencyRequest, Inventory


URGENCY_WEIGHTS = {
    "normal": 1,
    "high": 3,
    "critical": 9,
}

SCALE = 1000


def allocate_resource(
    requests: list[EmergencyRequest],
    available: int,
) -> dict[str, Any]:
    if available < 0:
        raise ValueError("Inventory cannot be negative")

    if not requests:
        return {
            "allocations": [],
            "available": available,
            "allocated": 0,
            "remaining": available,
            "fairness_score": 100.0,
            "fulfillment_rate": 100.0,
        }

    model = cp_model.CpModel()

    allocations = [
        model.new_int_var(
            0,
            request.quantity,
            f"allocation_{i}",
        )
        for i, request in enumerate(requests)
    ]

    # Never allocate more than available inventory.
    model.add(sum(allocations) <= available)

    # Minimum proportional fulfillment across requests.
    minimum_ratio = model.new_int_var(
        0, SCALE, "minimum_ratio"
    )

    for i, request in enumerate(requests):
        model.add(
            allocations[i] * SCALE
            >= minimum_ratio * request.quantity
        )

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1

    # Stage 1: maximize the minimum fulfillment ratio.
    model.maximize(minimum_ratio)

    status = solver.solve(model)

    if status != cp_model.OPTIMAL:
        raise RuntimeError(
            "Could not prove the optimal fairness allocation"
        )

    best_ratio = solver.value(minimum_ratio)

    # Stage 2: preserve fairness and prioritize urgency.
    model.add(minimum_ratio == best_ratio)

    weighted_fulfillment = []

    for i, request in enumerate(requests):
        weight = URGENCY_WEIGHTS[request.urgency]

        # Integer priority scores based on delivered units.
        weighted_fulfillment.append(
            weight * allocations[i]
        )

    model.maximize(sum(weighted_fulfillment))

    status = solver.solve(model)

    if status != cp_model.OPTIMAL:
        raise RuntimeError(
            "Could not prove the optimal priority allocation"
        )

    results = []

    for i, request in enumerate(requests):
        allocated = solver.value(allocations[i])

        results.append({
            "message_id": str(request.message_id),
            "household_id": request.household_id,
            "level": request.level,
            "resource": request.resource,
            "urgency": request.urgency,
            "requested": request.quantity,
            "allocated": allocated,
            "unmet": request.quantity - allocated,
            "fulfillment_percent": round(
                allocated / request.quantity * 100,
                2,
            ),
        })

    total_requested = sum(
        request.quantity for request in requests
    )

    total_allocated = sum(
        item["allocated"] for item in results
    )

    return {
        "allocations": results,
        "available": available,
        "allocated": total_allocated,
        "remaining": available - total_allocated,
        "fairness_score": round(
            min(
                item["fulfillment_percent"]
                for item in results
            ),
            2,
        ),
        "fulfillment_rate": round(
            total_allocated / total_requested * 100,
            2,
        ),
    }


def first_come_first_served(
    requests: list[EmergencyRequest],
    available: int,
) -> dict[str, Any]:
    remaining = available
    results = []

    # Deterministic ordering for reproducible comparisons.
    ordered_requests = sorted(
        requests,
        key=lambda request: (
            request.received_at,
            str(request.message_id),
        ),
    )

    for request in ordered_requests:
        allocated = min(request.quantity, remaining)
        remaining -= allocated

        results.append({
            "message_id": str(request.message_id),
            "household_id": request.household_id,
            "requested": request.quantity,
            "allocated": allocated,
            "fulfillment_percent": round(
                allocated / request.quantity * 100,
                2,
            ),
        })

    total_requested = sum(
        request.quantity for request in requests
    )

    total_allocated = sum(
        item["allocated"] for item in results
    )

    return {
        "allocations": results,
        "available": available,
        "allocated": total_allocated,
        "remaining": remaining,
        "fairness_score": (
            round(
                min(
                    item["fulfillment_percent"]
                    for item in results
                ),
                2,
            )
            if results
            else 100.0
        ),
        "fulfillment_rate": (
            round(
                total_allocated / total_requested * 100,
                2,
            )
            if total_requested
            else 100.0
        ),
    }


def run_allocation(
    requests: list[EmergencyRequest],
    inventory: list[Inventory],
) -> dict[str, Any]:
    inventory_map = {
        item.resource: item.available
        for item in inventory
    }

    grouped_requests = defaultdict(list)

    for request in requests:
        grouped_requests[request.resource].append(
            request
        )

    results = {}

    for resource in ["food", "water", "medicine"]:
        resource_requests = grouped_requests[resource]
        available = inventory_map.get(resource, 0)

        optimized = allocate_resource(
            resource_requests,
            available,
        )

        baseline = first_come_first_served(
            resource_requests,
            available,
        )

        results[resource] = {
            "optimized": optimized,
            "baseline": baseline,
        }

    return {
        "status": "draft",
        "requires_human_approval": True,
        "policy": (
            "Maximize minimum request fulfillment, "
            "then maximize urgency-weighted allocated units"
        ),
        "resources": results,
    }
