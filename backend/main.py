import os
import math
import random
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator


KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY", "faa3869240e454c8a6be06fbc2974992")


class Waypoint(BaseModel):
	theme_keyword: str = Field(..., min_length=1, description="Search keyword for this waypoint")
	order: int = Field(..., ge=1, description="Order of this waypoint in the route")

	@validator("theme_keyword")
	def strip_keyword(cls, v: str) -> str:
		return v.strip()


class RecommendRequest(BaseModel):
	start_lat: float = Field(..., description="Starting latitude")
	start_lng: float = Field(..., description="Starting longitude")
	total_distance_km: float = Field(..., gt=0, description="Total desired running distance in kilometers")
	waypoints: List[Waypoint] = Field(default=[], description="List of waypoints to visit")
	is_round_trip: bool = Field(default=True, description="Whether to return to start point (round trip) or end at last waypoint (one way)")


class WaypointResult(BaseModel):
	place_name: str
	address_name: Optional[str]
	road_address_name: Optional[str]
	phone: Optional[str]
	place_url: Optional[str]
	category_name: Optional[str]
	x: str
	y: str
	distance_km: float
	theme_keyword: str
	order: int


class RecommendResponse(BaseModel):
	waypoints: List[WaypointResult]
	route_url: str
	total_distance_km: float
	actual_total_distance_km: float
	is_round_trip: bool
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


def calculate_destination_point(start_lat: float, start_lng: float, distance_km: float, bearing_deg: float) -> tuple[float, float]:
	"""시작점에서 특정 거리와 방향으로 떨어진 지점의 좌표를 계산합니다."""
	R = 6371.0  # 지구 반지름 (km)
	
	# 각도를 라디안으로 변환
	bearing_rad = math.radians(bearing_deg)
	lat1_rad = math.radians(start_lat)
	lng1_rad = math.radians(start_lng)
	
	# 목적지 좌표 계산
	lat2_rad = math.asin(
		math.sin(lat1_rad) * math.cos(distance_km / R) +
		math.cos(lat1_rad) * math.sin(distance_km / R) * math.cos(bearing_rad)
	)
	
	lng2_rad = lng1_rad + math.atan2(
		math.sin(bearing_rad) * math.sin(distance_km / R) * math.cos(lat1_rad),
		math.cos(distance_km / R) - math.sin(lat1_rad) * math.sin(lat2_rad)
	)
	
	# 라디안을 도로 변환
	dest_lat = math.degrees(lat2_rad)
	dest_lng = math.degrees(lng2_rad)
	
	return dest_lat, dest_lng


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


async def find_waypoint_places(
	keyword: str,
	center_lat: float,
	center_lng: float,
	search_radius_m: int = 2000
) -> List[Dict[str, Any]]:
	"""경유지 주변에서 키워드로 장소를 검색합니다."""
	places = await kakao_keyword_search(keyword, x=center_lng, y=center_lat, radius_m=search_radius_m, page_limit=30)
	
	# 장소들을 중심점에서의 거리로 계산
	scored: List[Dict[str, Any]] = []
	for p in places:
		try:
			lat = float(p["y"])
			lng = float(p["x"])
		except Exception:
			continue
		
		d_km = haversine_km(center_lat, center_lng, lat, lng)
		p_copy = dict(p)
		p_copy["distance_km"] = d_km
		scored.append(p_copy)
	
	# 거리순으로 정렬
	scored.sort(key=lambda x: x["distance_km"])
	return scored


def distribute_distance_for_waypoints(total_distance_km: float, waypoint_count: int, is_round_trip: bool) -> List[float]:
	"""총 거리를 경유지들 사이의 거리로 분배합니다."""
	if waypoint_count == 0:
		return []
	
	# 왕복일 경우 마지막에 시작점으로 돌아가는 거리도 고려
	if is_round_trip:
		# 각 구간의 평균 거리 계산
		segment_count = waypoint_count + 1  # 경유지들 사이 + 마지막 경유지에서 시작점으로
		avg_distance = total_distance_km / segment_count
		distances = [avg_distance] * waypoint_count
	else:
		# 편도일 경우 경유지들 사이의 거리만 계산
		avg_distance = total_distance_km / waypoint_count
		distances = [avg_distance] * waypoint_count
	
	return distances


@app.post("/api/recommend", response_model=RecommendResponse)
async def recommend(req: RecommendRequest) -> RecommendResponse:
	start_lat = req.start_lat
	start_lng = req.start_lng
	total_distance_km = req.total_distance_km
	waypoints = req.waypoints
	is_round_trip = req.is_round_trip
	
	# 경유지가 없는 경우 기본 동작 (단일 목적지)
	if not waypoints:
		# 기존 로직 유지 - 단일 목적지
		random_bearing = random.uniform(0, 360)
		target_lat, target_lng = calculate_destination_point(start_lat, start_lng, total_distance_km, random_bearing)
		
		places = await kakao_keyword_search("카페", x=target_lng, y=target_lat, radius_m=1000, page_limit=30)
		
		if not places:
			route_url = build_kakao_walk_url([{"name": "Start", "lat": f"{start_lat}", "lng": f"{start_lng}"}])
			return RecommendResponse(waypoints=[], route_url=route_url, total_distance_km=total_distance_km, actual_total_distance_km=0, is_round_trip=is_round_trip, candidates_considered=0)
		
		# 첫 번째 장소 선택
		selected = places[0]
		dest_name = selected.get("place_name") or "Destination"
		dest_lat = f"{selected['y']}"
		dest_lng = f"{selected['x']}"
		
		route_points = [{"name": "Start", "lat": f"{start_lat}", "lng": f"{start_lng}"}]
		route_points.append({"name": dest_name, "lat": dest_lat, "lng": dest_lng})
		
		if is_round_trip:
			route_points.append({"name": "Start", "lat": f"{start_lat}", "lng": f"{start_lng}"})
		
		route_url = build_kakao_walk_url(route_points)
		
		waypoint_result = WaypointResult(
			place_name=dest_name,
			address_name=selected.get("address_name"),
			road_address_name=selected.get("road_address_name"),
			phone=selected.get("phone"),
			place_url=selected.get("place_url"),
			category_name=selected.get("category_name"),
			x=selected.get("x"),
			y=selected.get("y"),
			distance_km=haversine_km(start_lat, start_lng, float(selected["y"]), float(selected["x"])),
			theme_keyword="카페",
			order=1
		)
		
		# 실제 총 거리 계산
		actual_total_distance = waypoint_result.distance_km
		if is_round_trip:
			actual_total_distance += waypoint_result.distance_km  # 왕복이므로 2배
		
		return RecommendResponse(
			waypoints=[waypoint_result],
			route_url=route_url,
			total_distance_km=total_distance_km,
			actual_total_distance_km=round(actual_total_distance, 2),
			is_round_trip=is_round_trip,
			candidates_considered=len(places)
		)
	
	# 경유지가 있는 경우
	waypoint_count = len(waypoints)
	segment_distances = distribute_distance_for_waypoints(total_distance_km, waypoint_count, is_round_trip)
	
	waypoint_results = []
	route_points = [{"name": "Start", "lat": f"{start_lat}", "lng": f"{start_lng}"}]
	current_lat, current_lng = start_lat, start_lng
	total_candidates = 0
	
	# 각 경유지에 대해 장소 찾기
	for i, waypoint in enumerate(sorted(waypoints, key=lambda w: w.order)):
		# 현재 위치에서 다음 경유지까지의 거리
		segment_distance = segment_distances[i] if i < len(segment_distances) else segment_distances[-1]
		
		# 랜덤한 방향으로 거리만큼 떨어진 지점 계산
		random_bearing = random.uniform(0, 360)
		target_lat, target_lng = calculate_destination_point(current_lat, current_lng, segment_distance, random_bearing)
		
		# 해당 지점 주변에서 키워드로 장소 검색
		places = await find_waypoint_places(waypoint.theme_keyword, target_lat, target_lng, 1000)
		
		if not places:
			# 장소를 찾지 못한 경우 기본 목적지 생성
			selected = {
				"place_name": f"{waypoint.theme_keyword} 목적지",
				"address_name": None,
				"road_address_name": None,
				"phone": None,
				"place_url": None,
				"category_name": waypoint.theme_keyword,
				"x": str(target_lng),
				"y": str(target_lat)
			}
		else:
			# 첫 번째 장소 선택 (가장 가까운 장소)
			selected = places[0]
		
		total_candidates += len(places)
		
		# 결과 저장
		waypoint_result = WaypointResult(
			place_name=selected.get("place_name") or f"{waypoint.theme_keyword} 목적지",
			address_name=selected.get("address_name"),
			road_address_name=selected.get("road_address_name"),
			phone=selected.get("phone"),
			place_url=selected.get("place_url"),
			category_name=selected.get("category_name"),
			x=selected.get("x"),
			y=selected.get("y"),
			distance_km=haversine_km(current_lat, current_lng, float(selected["y"]), float(selected["x"])),
			theme_keyword=waypoint.theme_keyword,
			order=waypoint.order
		)
		waypoint_results.append(waypoint_result)
		
		# 경로에 추가
		route_points.append({
			"name": waypoint_result.place_name,
			"lat": waypoint_result.y,
			"lng": waypoint_result.x
		})
		
		# 다음 경유지를 위해 현재 위치 업데이트
		current_lat = float(selected["y"])
		current_lng = float(selected["x"])
	
	# 왕복일 경우 시작점으로 돌아가는 경로 추가
	if is_round_trip:
		route_points.append({"name": "Start", "lat": f"{start_lat}", "lng": f"{start_lng}"})
	
	route_url = build_kakao_walk_url(route_points)
	
	# 실제 총 거리 계산
	actual_total_distance = 0
	for waypoint_result in waypoint_results:
		actual_total_distance += waypoint_result.distance_km
	
	# 왕복일 경우 마지막 경유지에서 시작점까지의 거리 추가
	if is_round_trip and waypoint_results:
		last_waypoint = waypoint_results[-1]
		return_distance = haversine_km(
			float(last_waypoint.y), 
			float(last_waypoint.x), 
			start_lat, 
			start_lng
		)
		actual_total_distance += return_distance

	return RecommendResponse(
		waypoints=waypoint_results,
		route_url=route_url,
		total_distance_km=total_distance_km,
		is_round_trip=is_round_trip,
		candidates_considered=total_candidates,
		actual_total_distance_km=round(actual_total_distance, 2)
	)


if __name__ == "__main__":
	import uvicorn

	uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=True)

