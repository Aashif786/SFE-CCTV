from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, UniqueConstraint, Date
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


class IdentityEventDB(Base):
    """
    Persisted record of every identity event received from any provider.
    Correlation status is updated in-place when a match is found.
    """
    __tablename__ = "identity_events"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(String, unique=True, nullable=False, index=True)
    employee_id = Column(String, nullable=False, index=True)
    employee_name = Column(String, nullable=True)
    event_type = Column(String, nullable=False, default="ENTRY")  # ENTRY | EXIT (future)
    timestamp = Column(DateTime, nullable=False, index=True)
    entry_gate = Column(String, nullable=False)
    provider = Column(String, nullable=False)  # REST_SIMULATOR | RFID | NFC | MQTT …
    correlation_status = Column(String, nullable=False, default="WAITING_FOR_TRACK")
    matched_track_id = Column(String, nullable=True)   # populated on MATCHED
    matched_at = Column(DateTime, nullable=True)        # UTC time of successful match
    correlation_delay_seconds = Column(Float, nullable=True)


class WorkerSessionDB(Base):
    """
    A resolved identity ↔ track binding. One row per named person appearance.
    status transitions: ACTIVE → CLOSED when the person leaves the frame.
    """
    __tablename__ = "worker_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, unique=True, nullable=False, index=True)
    employee_id = Column(String, nullable=False, index=True)
    current_track_id = Column(String, nullable=False)   # updated if tracker reassigns
    camera_id = Column(String, nullable=False, index=True)
    start_time = Column(DateTime, nullable=False, index=True)
    end_time = Column(DateTime, nullable=True)           # NULL while ACTIVE
    status = Column(String, nullable=False, default="ACTIVE")  # ACTIVE | CLOSED
    correlation_delay_seconds = Column(Float, nullable=False)


class EmployeeDailySummary(Base):
    """
    Aggregated daily time breakdown per employee.

    One row per (employee_id, date). Updated incrementally each time a
    WorkerSession closes — so multiple check-ins per day accumulate correctly.

    All time columns are in seconds.
    """
    __tablename__ = "employee_daily_summary"
    __table_args__ = (
        UniqueConstraint("employee_id", "date", name="uq_employee_date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(String, nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)

    # Time spent in each activity state during on-camera window
    working_seconds       = Column(Float, nullable=False, default=0.0)
    idle_seconds          = Column(Float, nullable=False, default=0.0)
    walking_seconds       = Column(Float, nullable=False, default=0.0)
    # Total on-camera time (sum of all tracked activities)
    total_seconds         = Column(Float, nullable=False, default=0.0)

    # Attendance metadata
    check_in_count = Column(Integer, nullable=False, default=0)  # number of WorkerSessions closed today
    first_seen = Column(DateTime, nullable=True)   # earliest session start today
    last_seen  = Column(DateTime, nullable=True)   # latest session end today
