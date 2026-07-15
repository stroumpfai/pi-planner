from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feature import Feature
from app.models.group import Group
from app.models.pbi import PBI
from app.models.pi import PI
from app.models.pi_event import PIEvent
from app.models.project import Project
from app.models.sprint import Sprint
from app.models.swimline import Swimline
from app.services.effort import feature_efforts


def _opt_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def restore_pi_structures(db: AsyncSession, proj_data: dict[str, Any], project_id: str) -> None:
    for pi in proj_data["pis"]:
        db.add(PI(
            system_id=pi["system_id"],
            project_id=project_id,
            name=pi["name"],
            description=pi.get("description"),
            state=pi.get("state", "draft"),
            start_date=_opt_date(pi.get("start_date")),
            end_date=_opt_date(pi.get("end_date")),
        ))
        for sl in pi.get("swimlines", []):
            db.add(Swimline(
                system_id=sl["system_id"],
                pi_id=pi["system_id"],
                name=sl["name"],
                order_index=sl.get("order_index"),
            ))
        for s in pi.get("sprints", []):
            db.add(Sprint(
                system_id=s["system_id"],
                pi_id=pi["system_id"],
                sprint_index=s.get("sprint_index"),
                capacity=s.get("capacity") or 0,
                start_date=_opt_date(s.get("start_date")),
                end_date=_opt_date(s.get("end_date")),
            ))
        for e in pi.get("events", []):
            db.add(PIEvent(
                system_id=e["system_id"],
                pi_id=pi["system_id"],
                name=e["name"],
                event_date=_opt_date(e.get("event_date")),
                event_type=e.get("event_type", "other"),
            ))


def restore_features(db: AsyncSession, proj_data: dict[str, Any], project_id: str) -> None:
    for f in proj_data["features"]:
        db.add(Feature(
            system_id=f["system_id"],
            project_id=project_id,
            user_id=f.get("id"),
            title=f["title"],
            description=f.get("description"),
            location=f.get("location", "backlog"),
            pi_id=f.get("pi_id"),
            swimlane_id=f.get("swimlane_id"),
        ))


def restore_groups(db: AsyncSession, proj_data: dict[str, Any]) -> None:
    for pi in proj_data["pis"]:
        for sl in pi.get("swimlines", []):
            for g in sl.get("groups", []):
                db.add(Group(
                    system_id=g["system_id"],
                    swimline_id=sl["system_id"],
                    feature_system_id=g["feature_system_id"],
                    name=g["name"],
                    sprint_index=g.get("sprint_index"),
                    order_index=g.get("order_index"),
                    is_implicit=g.get("is_implicit", False),
                ))


def restore_pbis(db: AsyncSession, proj_data: dict[str, Any], project_id: str) -> None:
    for p in proj_data["pbis"]:
        db.add(PBI(
            system_id=p["system_id"],
            project_id=project_id,
            user_id=p.get("id"),
            parent_feature_system_id=p["parent_feature_system_id"],
            title=p["title"],
            description=p.get("description"),
            effort=p.get("effort"),
            item_type=p.get("item_type", "story"),
            location=p.get("location", "backlog"),
            pi_id=p.get("pi_id"),
            swimlane_id=p.get("swimlane_id"),
            group_id=p.get("group_id"),
        ))


async def restore_continuations_and_stories(db: AsyncSession, proj_data: dict[str, Any]) -> None:
    """Second-pass linking, run after features/groups/PBIs are flushed.

    Sets the two references that point at rows created in the same rebuild batch and so
    cannot be satisfied at insert time: ``Feature.continued_from_feature_id`` (self-referential)
    and ``Group.story_system_id`` (group → PBI, a circular table dependency). IDs are the
    snapshot's original system_ids, so no remapping is needed here.
    """
    for f in proj_data["features"]:
        origin = f.get("continued_from_feature_id")
        if origin:
            feature = await db.get(Feature, f["system_id"])
            if feature is not None:
                feature.continued_from_feature_id = origin
    for pi in proj_data["pis"]:
        for sl in pi.get("swimlines", []):
            for g in sl.get("groups", []):
                story = g.get("story_system_id")
                if story:
                    group = await db.get(Group, g["system_id"])
                    if group is not None:
                        group.story_system_id = story
    await db.flush()


async def serialize_project(db: AsyncSession, project: Project) -> dict[str, Any]:
    """Build the export-format payload for a project.

    Returns the `{"version": "1.0", "exported_at": ..., "project": {...}}` dict
    shape shared by the project export endpoint and project snapshots.
    """
    project_id = project.system_id

    features_result = await db.execute(
        select(Feature).where(Feature.project_id == project_id).order_by(Feature.created_at)
    )
    features = features_result.scalars().all()
    feat_efforts = await feature_efforts(db, [f.system_id for f in features])

    pbis_result = await db.execute(
        select(PBI).where(PBI.project_id == project_id).order_by(PBI.created_at)
    )
    pbis = pbis_result.scalars().all()

    pis_result = await db.execute(
        select(PI).where(PI.project_id == project_id).order_by(PI.created_at)
    )
    pis = pis_result.scalars().all()

    pi_data = []
    for pi in pis:
        swimlines_result = await db.execute(
            select(Swimline).where(Swimline.pi_id == pi.system_id).order_by(Swimline.order_index)
        )
        swimlines = swimlines_result.scalars().all()

        swimline_data = []
        for sl in swimlines:
            groups_result = await db.execute(
                select(Group).where(Group.swimline_id == sl.system_id).order_by(Group.sprint_index, Group.order_index)
            )
            groups = groups_result.scalars().all()
            swimline_data.append({
                "system_id": sl.system_id,
                "name": sl.name,
                "order_index": sl.order_index,
                "groups": [
                    {
                        "system_id": g.system_id,
                        "name": g.name,
                        "feature_system_id": g.feature_system_id,
                        "sprint_index": g.sprint_index,
                        "order_index": g.order_index,
                        "is_implicit": g.is_implicit,
                        "story_system_id": g.story_system_id,
                    }
                    for g in groups
                ],
            })

        sprints_result = await db.execute(
            select(Sprint).where(Sprint.pi_id == pi.system_id).order_by(Sprint.sprint_index)
        )
        sprints = sprints_result.scalars().all()

        events_result = await db.execute(
            select(PIEvent).where(PIEvent.pi_id == pi.system_id).order_by(PIEvent.event_date)
        )
        events = events_result.scalars().all()

        pi_data.append({
            "system_id": pi.system_id,
            "name": pi.name,
            "description": pi.description,
            "state": pi.state,
            "start_date": pi.start_date.isoformat() if pi.start_date else None,
            "end_date": pi.end_date.isoformat() if pi.end_date else None,
            "created_at": pi.created_at.isoformat(),
            "modified_at": pi.modified_at.isoformat(),
            "swimlines": swimline_data,
            "sprints": [
                {
                    "system_id": s.system_id,
                    "sprint_index": s.sprint_index,
                    "capacity": s.capacity,
                    "start_date": s.start_date.isoformat() if s.start_date else None,
                    "end_date": s.end_date.isoformat() if s.end_date else None,
                }
                for s in sprints
            ],
            "events": [
                {
                    "system_id": e.system_id,
                    "name": e.name,
                    "event_date": e.event_date.isoformat() if e.event_date else None,
                    "event_type": e.event_type,
                }
                for e in events
            ],
        })

    return {
        "version": "1.0",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "project": {
            "system_id": project.system_id,
            "name": project.name,
            "description": project.description,
            "azure_devops_url": project.azure_devops_url,
            "effort_unit": project.effort_unit,
            "created_at": project.created_at.isoformat(),
            "modified_at": project.modified_at.isoformat(),
            "features": [
                {
                    "system_id": f.system_id,
                    "id": f.user_id,
                    "title": f.title,
                    "description": f.description,
                    "effort": feat_efforts.get(f.system_id, 0),
                    "location": f.location,
                    "pi_id": f.pi_id,
                    "swimlane_id": f.swimlane_id,
                    "continued_from_feature_id": f.continued_from_feature_id,
                    "created_at": f.created_at.isoformat(),
                    "modified_at": f.modified_at.isoformat(),
                }
                for f in features
            ],
            "pbis": [
                {
                    "system_id": p.system_id,
                    "id": p.user_id,
                    "parent_feature_system_id": p.parent_feature_system_id,
                    "title": p.title,
                    "description": p.description,
                    "effort": p.effort,
                    "item_type": p.item_type,
                    "location": p.location,
                    "pi_id": p.pi_id,
                    "swimlane_id": p.swimlane_id,
                    "group_id": p.group_id,
                    "created_at": p.created_at.isoformat(),
                    "modified_at": p.modified_at.isoformat(),
                }
                for p in pbis
            ],
            "pis": pi_data,
        },
    }
