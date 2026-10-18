"""Public community link and the deliberately closed read-tool contract."""
import ipaddress
import re
import socket
from hashlib import sha256
from urllib.parse import urlsplit

TOOLS = frozenset(("search_public_information", "get_public_resource",
    "get_public_service_hours", "get_public_event_timetable",
    "get_public_prayer_day", "list_public_prayer_calendars"))
SKILL = "makom-community"


def server_name(home, binding):
    # Native Hermes caches by server name across multiplexed profiles. An 88-bit
    # namespace binds BOTH the profile and configuration generation, while the
    # resulting native tool names still fit the providers' 64-character limit.
    identity = str(home.resolve()).casefold() + "|" + binding["revision"]
    return "makom-" + sha256(identity.encode()).hexdigest()[:22]


def parse_link(link):
    if not isinstance(link, str) or len(link) > 2048:
        raise ValueError("הדביקו קישור ציבורי לקהילה במקום")
    url = urlsplit(link.strip())
    local = url.scheme == "http" and url.hostname == "127.0.0.1" and url.port
    if (url.scheme != "https" and not local) or not url.hostname or url.username or url.password:
        raise ValueError("נדרש קישור HTTPS לקהילה במקום")
    match = re.fullmatch(r"/(?:public|c)/([a-z][a-z0-9-]{1,40})(?:/.*)?", url.path)
    if not match or url.query or url.fragment:
        raise ValueError("הדביקו את הקישור הראשי לקהילה, ללא פרמטרים")
    return {"origin": f"{url.scheme}://{url.netloc}", "communitySlug": match[1]}


def check_host(origin):
    """No ambient proxy, redirects or private-network HTTPS targets."""
    url = urlsplit(origin)
    if url.scheme == "http" and url.hostname == "127.0.0.1" and url.port:
        return
    addresses = socket.getaddrinfo(url.hostname, url.port or 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
        raise ValueError("כתובת האתר אינה כתובת ציבורית זמינה")


def bound_arguments(binding, name, arguments):
    if name not in TOOLS or not isinstance(arguments, dict) or "communitySlug" in arguments:
        raise ValueError("הכלי או הקהילה אינם מורשים בחיבור הזה")
    return {**arguments, "communitySlug": binding["communitySlug"]}
