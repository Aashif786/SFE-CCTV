from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, UniqueConstraint, Date
from datetime import datetime
from .database import Base


class Camera(Base):
    """
    Camera configuration model.

    Each row represents a physical RTSP camera. Credentials are stored
    encrypted (Fernet) — the plain RTSP URL is built dynamically on the
    backend only.  Location fields (building, floor, zone, door_name)
    support future RFID-to-camera correlation.
    """
    __tablename__ = "cameras"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    location = Column(String, nullable=True)
    building = Column(String, nullable=True)
    floor = Column(String, nullable=True)
    zone = Column(String, nullable=True)
    door_name = Column(String, nullable=True)
    ip_address = Column(String, nullable=False)
    rtsp_port = Column(Integer, default=554)
    stream_path = Column(String, default="/Streaming/Channels/101")
    username = Column(String, nullable=False)
    encrypted_password = Column(String, nullable=False)
    camera_brand = Column(String, nullable=True, default="Hikvision")
    stream_type = Column(String, default="Main")          # Main / Sub
    enabled = Column(Boolean, default=True)
    recording_enabled = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


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
    device_event_time = Column(String, nullable=True)             # ACS device timestamp string
    received_at = Column(DateTime, nullable=True)                 # Server receipt timestamp
    time_offset_seconds = Column(Float, nullable=True)            # Latency/offset in seconds
    auth_type = Column(String, nullable=True)                     # E.g. Face Recognition, Card Swipe
    card_no = Column(String, nullable=True)
    access_granted = Column(Boolean, default=True, nullable=True)
    entry_gate = Column(String, nullable=False)
    provider = Column(String, nullable=False)  # REST_SIMULATOR | RFID | NFC | MQTT …
    correlation_status = Column(String, nullable=False, default="WAITING_FOR_TRACK")
    allowed_cameras = Column(String, nullable=True)     # JSON array string or comma-separated
    matched_track_id = Column(String, nullable=True)   # populated on MATCHED
    matched_camera_id = Column(String, nullable=True)  # camera where person was matched
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
    persistent_track_id = Column(String, nullable=True) # Persisted application track ID
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

    # Designated Work Zone Productivity Metrics
    designated_zone_seconds = Column(Float, nullable=False, default=0.0)  # Time spent in assigned work zones
    outside_zone_seconds    = Column(Float, nullable=False, default=0.0)  # Time spent outside assigned work zones
    common_area_seconds     = Column(Float, nullable=False, default=0.0)  # Time spent in common/shared zones
    break_seconds           = Column(Float, nullable=False, default=0.0)  # Break time
    productivity_score      = Column(Float, nullable=False, default=100.0) # Calculated productivity %

    # Attendance metadata
    check_in_count = Column(Integer, nullable=False, default=0)  # number of WorkerSessions closed today
    first_seen = Column(DateTime, nullable=True)   # earliest session start today
    last_seen  = Column(DateTime, nullable=True)   # latest session end today


class EmployeeDB(Base):
    """
    Employee registry table for tracking configuration and zone assignments.
    """
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    department = Column(String, nullable=True, default="Engineering")
    designation = Column(String, nullable=True, default="Software Engineer")
    is_tracked = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EmployeeZoneDB(Base):
    """
    Mapping between employees and their designated camera work zones.
    Used to calculate zone-specific productivity metrics.
    """
    __tablename__ = "employee_zones"
    __table_args__ = (
        UniqueConstraint("employee_id", "camera_id", "zone_id", name="uq_emp_cam_zone"),
    )

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(String, nullable=False, index=True)
    camera_id = Column(String, nullable=False, index=True)
    zone_id = Column(String, nullable=False, index=True)
    zone_name = Column(String, nullable=True)
    is_designated = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class CameraZoneDB(Base):
    """
    Polygonal Region of Interest (ROI) zone per camera.
    Stores user-defined polygons, color, name, and enabled status.
    """
    __tablename__ = "camera_zones"
    __table_args__ = (
        UniqueConstraint("camera_id", "zone_id", name="uq_camera_zone"),
    )

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(String, nullable=False, index=True)
    zone_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    color = Column(String, nullable=False, default="#3B82F6")
    description = Column(String, nullable=True)
    points_json = Column(String, nullable=False)  # JSON array of [x, y] coordinates
    enabled = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ZoneVisitDB(Base):
    """
    Historical log of a person's dwell visit inside a camera zone.
    Tracks entry time, exit time, and calculated duration in seconds.
    """
    __tablename__ = "zone_visits"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(String, nullable=False, index=True)
    zone_id = Column(String, nullable=False, index=True)
    tracking_id = Column(String, nullable=False, index=True)
    person_identifier = Column(String, nullable=True, index=True)  # e.g., employee_id
    entry_time = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    exit_time = Column(DateTime, nullable=True, index=True)
    duration_seconds = Column(Float, nullable=True)
