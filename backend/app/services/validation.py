from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feature import Feature
from app.models.pbi import PBI


async def is_user_id_available(
    db: AsyncSession,
    project_id: str,
    user_id: int,
    exclude_feature_id: str | None = None,
    exclude_pbi_id: str | None = None,
) -> bool:
    """Return True if user_id is unused within the project (Features + PBIs share the namespace)."""
    feat_q = select(Feature.system_id).where(
        Feature.project_id == project_id,
        Feature.user_id == user_id,
    )
    if exclude_feature_id:
        feat_q = feat_q.where(Feature.system_id != exclude_feature_id)

    pbi_q = select(PBI.system_id).where(
        PBI.project_id == project_id,
        PBI.user_id == user_id,
    )
    if exclude_pbi_id:
        pbi_q = pbi_q.where(PBI.system_id != exclude_pbi_id)

    if (await db.execute(feat_q.limit(1))).first():
        return False
    if (await db.execute(pbi_q.limit(1))).first():
        return False
    return True
