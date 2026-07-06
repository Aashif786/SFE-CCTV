from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean
from datetime import datetime
from .database import Base

class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    status = Column(String)      # raw detector label (kept for legacy)
    activity = Column(String)    # classified business activity
    idle_seconds = Column(Float)
    movement_score = Column(Float)
    confidence = Column(Float)

class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    message = Column(String)
    resolved = Column(Boolean, default=False)

class ActivitySession(Base):
    """
    One continuous block of the same business activity.
    end_time / duration_seconds are NULL while the session is open.
    """
    __tablename__ = "activity_sessions"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(String, index=True, nullable=False)
    activity = Column(String, nullable=False)   # working | idle | walking | no_person | unknown
    start_time = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    end_time = Column(DateTime, nullable=True)
    duration_seconds = Column(Float, nullable=True)

class WorkstationZone(Base):
    """
    Rectangular workstation zone per camera, in normalised [0, 1] coordinates.
    Points outside this rectangle are considered "off-station" → walking.
    Default covers the whole frame until the user sets a tighter zone.
    """
    __tablename__ = "workstation_zones"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(String, unique=True, index=True, nullable=False)
    # Normalised coordinates (0.0 – 1.0)
    x_min = Column(Float, default=0.0, nullable=False)
    y_min = Column(Float, default=0.0, nullable=False)
    x_max = Column(Float, default=1.0, nullable=False)
    y_max = Column(Float, default=1.0, nullable=False)


