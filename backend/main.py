import os
import math
import random
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator


KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY", "faa3869240e454c8a6be06fbc2974992")


class RecommendRequest(BaseModel):
	start_lat: float = Field(..., description="Starting latitude")
	start_lng: float = Field(..., description="Starting longitude")
	distance_km: float = Field(..., gt=0, description="Desired running distance in kilometers")
	theme_keyword: str = Field(..., min_length=1, description="Search keyword, e.g., beer, cafe, food")

	@validator("theme_keyword")
	def strip_keyword(cls, v: str) -> str:
		return v.strip()


class RecommendResponse(BaseModel):
	selected_place: Optional[Dict[str, Any]]
	route_url: str
	candidates_considered: int


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
	"""Great-circle distance between two points on Earth (km)."""
	R = 6371.0
	phi1 = math.radians(lat1)
	phi2 = math.radians(lat2)
	dphi = math.radians(lat2 - lat1)
	dlambda = math.radians(lon2 - lon1)
	a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
	c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
	return R * c


def build_kakao_walk_url(points: List[Dict[str, str]]) -> str:
	"""Build Kakao map walk route URL using /link/by/walk pattern.
	points: list of dicts with keys name, lat, lng (lat/lng as strings)
	"""
	# Pattern: /link/by/walk/이름,위도,경도/이름,위도,경도/...
	# We will construct as https://map.kakao.com/link/by/walk/...
	parts = []
	for p in points:
		name = p.get("name", "Point")
		lat = p["lat"]
		lng = p["lng"]
		parts.append(f"{name},{lat},{lng}")
	return "https://map.kakao.com/link/by/walk/" + "/".join(parts)


async def kakao_keyword_search(
	query: str,
	x: float,
	y: float,
	radius_m: int,
	page_limit: int = 30,
) -> List[Dict[str, Any]]:
	"""Query Kakao Local Keyword Search API around a point within radius.
	Collect multiple pages up to page_limit.
	"""
	if not KAKAO_REST_API_KEY:
		raise HTTPException(status_code=500, detail="KAKAO_REST_API_KEY is not configured")

	headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
	url = "https://dapi.kakao.com/v2/local/search/keyword"
	results: List[Dict[str, Any]] = []

	async with httpx.AsyncClient(timeout=10.0) as client:
		# 마지막 페이지부터 시작해서 장소들을 수집
		params = {
			"query": query,
			"x": x,
			"y": y,
			"radius": radius_m,  # meters; Kakao supports up to 20000 for some endpoints
			"sort": "distance",
			"page": page_limit,  # 마지막 페이지부터 시작
			"size": 15,
		}
		r = await client.get(url, headers=headers, params=params)
		if r.status_code != 200:
			error_text = r.text
			if "NotAuthorizedError" in error_text and "OPEN_MAP_AND_LOCAL" in error_text:
				raise HTTPException(
					status_code=403, 
					detail="Kakao Local API service is not enabled. Please enable 'OPEN_MAP_AND_LOCAL' service in your Kakao Developers console."
				)
			raise HTTPException(status_code=502, detail=f"Kakao API error: {error_text}")
		data = r.json()
		documents = data.get("documents", [])
		results.extend(documents)
	return results


app = FastAPI(title="Running Route Recommender")

app.add_middleware(
	CORSMiddleware,
	allow_origins=["*"],  # For development; tighten in production
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)


@app.get("/health")
async def health() -> Dict[str, str]:
	return {"status": "ok"}


@app.post("/api/recommend", response_model=RecommendResponse)
async def recommend(req: RecommendRequest) -> RecommendResponse:
	# Strategy: find candidate places within desired radius; choose one whose distance to start
	# is closest to desired distance (km). If many within a small band (+/- 10%), pick random.
	desired_km = req.distance_km
	start_lat = req.start_lat
	start_lng = req.start_lng
	keyword = req.theme_keyword

	# Convert to meters for Kakao radius; cap at 20000 per API common practice
	radius_m = int(min(max(desired_km * 1000, 500), 20000))

	places = await kakao_keyword_search(keyword, x=start_lng, y=start_lat, radius_m=radius_m, page_limit=30)

	if not places:
		# Build a simple URL that at least shows the start point
		route_url = build_kakao_walk_url([
			{
				"name": "Start",
				"lat": f"{start_lat}",
				"lng": f"{start_lng}",
			}
		])
		return RecommendResponse(selected_place=None, route_url=route_url, candidates_considered=0)

	# Compute distances and sort by closeness to desired distance (one-way)
	scored: List[Dict[str, Any]] = []
	for p in places:
		try:
			lat = float(p["y"])  # Kakao returns y: lat, x: lng as strings
			lng = float(p["x"])
		except Exception:
			continue
		d_km = haversine_km(start_lat, start_lng, lat, lng)
		p_copy = dict(p)
		p_copy["distance_km"] = d_km
		p_copy["distance_delta"] = abs(d_km - desired_km)
		scored.append(p_copy)

	if not scored:
		route_url = build_kakao_walk_url([
			{
				"name": "Start",
				"lat": f"{start_lat}",
				"lng": f"{start_lng}",
			}
		])
		return RecommendResponse(selected_place=None, route_url=route_url, candidates_considered=0)

	# 거리별로 정렬 (사용자가 원하는 거리에 가까운 순서)
	scored.sort(key=lambda x: x["distance_delta"])
	
	# 러닝 거리 계산: 왕복 또는 원형 코스 고려
	# 사용자가 원하는 거리의 절반 지점에 있는 장소를 찾아야 함
	# 예: 5km 러닝을 원한다면 2.5km 지점의 장소를 찾아야 함
	target_distance = desired_km / 2  # 왕복을 고려한 목표 거리
	
	# 허용 오차: 최소 200m 또는 목표 거리의 25%
	tolerance = max(0.2, target_distance * 0.25)
	
	# 1차: 목표 거리(왕복의 절반) 허용 오차 내의 장소들
	perfect_matches = [p for p in scored if abs(p["distance_km"] - target_distance) <= tolerance]
	
	# 2차: 목표 거리의 1.5배 허용 오차 내의 장소들
	good_matches = [p for p in scored if abs(p["distance_km"] - target_distance) <= tolerance * 1.5]
	
	# 3차: 모든 장소 중 상위 10개
	fallback_matches = scored[:min(10, len(scored))]
	
	# 선택 우선순위: perfect_matches > good_matches > fallback_matches
	if perfect_matches:
		pool = perfect_matches
		print(f"Found {len(perfect_matches)} perfect matches for {desired_km:.1f}km run (target: {target_distance:.1f}km ± {tolerance:.1f}km)")
	elif good_matches:
		pool = good_matches
		print(f"Found {len(good_matches)} good matches for {desired_km:.1f}km run (target: {target_distance:.1f}km ± {tolerance*1.5:.1f}km)")
	else:
		pool = fallback_matches
		print(f"Using fallback: top {len(fallback_matches)} closest places for {desired_km:.1f}km run")

	# 랜덤 선택
	selected = random.choice(pool)
	
	# 왕복 거리 계산
	round_trip_distance = selected.get('distance_km', 0) * 2
	
	print(f"Selected: {selected.get('place_name', 'Unknown')} at {selected.get('distance_km', 0):.2f}km (round trip: {round_trip_distance:.2f}km, target: {desired_km:.2f}km)")

	# Build route URL from start to selected destination
	dest_name = selected.get("place_name") or selected.get("place_url", "Destination")
	dest_lat = f"{selected['y']}"
	dest_lng = f"{selected['x']}"
	route_url = build_kakao_walk_url(
		[
			{"name": "Start", "lat": f"{start_lat}", "lng": f"{start_lng}"},
			{"name": dest_name, "lat": dest_lat, "lng": dest_lng},
		]
	)

	# Prepare a minimal selected_place payload
	selected_payload = {
		"place_name": selected.get("place_name"),
		"address_name": selected.get("address_name"),
		"road_address_name": selected.get("road_address_name"),
		"phone": selected.get("phone"),
		"place_url": selected.get("place_url"),
		"category_name": selected.get("category_name"),
		"x": selected.get("x"),
		"y": selected.get("y"),
		"distance_km": round(selected.get("distance_km", 0.0), 3),
	}

	return RecommendResponse(
		selected_place=selected_payload,
		route_url=route_url,
		candidates_considered=len(scored),
	)


if __name__ == "__main__":
	import uvicorn

	uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=True)

