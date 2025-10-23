import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL

function useKakaoLoader() {
	const [loaded, setLoaded] = useState(false)
	const [error, setError] = useState(null)
	useEffect(() => {
		console.log('KAKAO_JS_KEY:', KAKAO_JS_KEY)
		
		if (!KAKAO_JS_KEY) {
			console.error('KAKAO_JS_KEY is not set')
			setError('KAKAO_JS_KEY is not set')
			return
		}

		// 이미 로드된 경우
		if (window.kakao && window.kakao.maps && window.kakao.maps.Map) {
			console.log('Kakao already loaded')
			setLoaded(true)
			return
		}

		// 스크립트가 이미 로드 중인지 확인
		const existingScript = document.querySelector('script[src*="dapi.kakao.com"]')
		if (existingScript) {
			console.log('Kakao script already exists, waiting for load...')
			// 기존 스크립트가 로드될 때까지 기다림
			const checkLoaded = () => {
				if (window.kakao && window.kakao.maps && window.kakao.maps.Map) {
					console.log('Kakao Maps API ready')
					setLoaded(true)
				} else {
					setTimeout(checkLoaded, 100)
				}
			}
			checkLoaded()
			return
		}

		// 새 스크립트 로드
		const script = document.createElement('script')
		script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false`
		script.async = true
		
		script.onload = () => {
			console.log('Kakao script loaded, initializing...')
			// kakao.maps.load() 사용하여 완전한 로딩 대기
			if (window.kakao && window.kakao.maps && window.kakao.maps.load) {
				window.kakao.maps.load(() => {
					console.log('Kakao Maps API fully loaded')
					setLoaded(true)
				})
			} else {
				// fallback: 직접 확인
				const checkLoaded = () => {
					if (window.kakao && window.kakao.maps && window.kakao.maps.Map) {
						console.log('Kakao Maps API ready (fallback)')
						setLoaded(true)
					} else {
						setTimeout(checkLoaded, 100)
					}
				}
				checkLoaded()
			}
		}
		
		script.onerror = (e) => {
			console.error('Failed to load Kakao script:', e)
			setError('Failed to load Kakao Maps')
		}
		
		document.head.appendChild(script)
		
		return () => {
			if (document.head.contains(script)) {
				document.head.removeChild(script)
			}
		}
	}, [])
	return { loaded, error }
}

function MapPicker({ onPick }) {
	const ref = useRef(null)
	const [coords, setCoords] = useState(null)
	const { loaded, error } = useKakaoLoader()

	useEffect(() => {
		if (!loaded || !ref.current) return
		
		console.log('Initializing Kakao Map...')
		const kakao = window.kakao
		
		try {
			// 지도 생성
			const map = new kakao.maps.Map(ref.current, {
				center: new kakao.maps.LatLng(37.5665, 126.978),
				level: 5,
			})
			
			// 마커 생성
			const marker = new kakao.maps.Marker({ 
				position: map.getCenter() 
			})
			marker.setMap(map)
			
			// 클릭 이벤트 등록
			kakao.maps.event.addListener(map, 'click', function (mouseEvent) {
				const latlng = mouseEvent.latLng
				marker.setPosition(latlng)
				const lat = latlng.getLat()
				const lng = latlng.getLng()
				setCoords({ lat, lng })
				onPick(lat, lng)
			})
			
			console.log('Kakao Map initialized successfully')
		} catch (error) {
			console.error('Error initializing Kakao Map:', error)
		}
	}, [loaded, onPick])

	if (error) {
		return (
			<div>
				<div style={{ width: '100%', height: 360, borderRadius: 8, border: '1px solid #ddd', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f5' }}>
					<div style={{ textAlign: 'center', color: '#666' }}>
						<div>❌ {error}</div>
						<div style={{ fontSize: 12, marginTop: 8 }}>카카오 지도 API 키를 확인해주세요</div>
					</div>
				</div>
			</div>
		)
	}

	if (!loaded) {
		return (
			<div>
				<div style={{ width: '100%', height: 360, borderRadius: 8, border: '1px solid #ddd', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f5' }}>
					<div style={{ textAlign: 'center', color: '#666' }}>
						<div>🔄 카카오 지도 로딩 중...</div>
					</div>
				</div>
			</div>
		)
	}

	return (
		<div>
			<div ref={ref} style={{ width: '100%', height: 360, borderRadius: 8, border: '1px solid #ddd' }} />
			<div style={{ marginTop: 8, fontSize: 14 }}>
				{coords ? `선택 위치: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : '지도를 클릭하여 시작 위치를 선택하세요'}
			</div>
		</div>
	)
}

export default function App() {
	const [lat, setLat] = useState(null)
	const [lng, setLng] = useState(null)
	const [totalDistanceKm, setTotalDistanceKm] = useState(7)
	const [isRoundTrip, setIsRoundTrip] = useState(true)
	const [waypoints, setWaypoints] = useState([
		{ theme_keyword: '카페', order: 1 },
		{ theme_keyword: '맛집', order: 2 },
		{ theme_keyword: '맥주', order: 3 }
	])
	const [loading, setLoading] = useState(false)
	const [result, setResult] = useState(null)
	const [error, setError] = useState(null)

	const canSubmit = lat !== null && lng !== null && totalDistanceKm > 0 && waypoints.length > 0

	const onPick = useCallback((la, ln) => {
		setLat(la)
		setLng(ln)
	}, [])

	const addWaypoint = () => {
		const newOrder = Math.max(...waypoints.map(w => w.order), 0) + 1
		setWaypoints([...waypoints, { theme_keyword: '', order: newOrder }])
	}

	const removeWaypoint = (order) => {
		setWaypoints(waypoints.filter(w => w.order !== order).map((w, index) => ({ ...w, order: index + 1 })))
	}

	const updateWaypoint = (order, theme_keyword) => {
		setWaypoints(waypoints.map(w => w.order === order ? { ...w, theme_keyword } : w))
	}

	const [draggedItem, setDraggedItem] = useState(null)

	const handleDragStart = (e, order) => {
		setDraggedItem(order)
		e.dataTransfer.effectAllowed = 'move'
	}

	const handleDragOver = (e) => {
		e.preventDefault()
		e.dataTransfer.dropEffect = 'move'
	}

	const handleDrop = (e, targetOrder) => {
		e.preventDefault()
		if (!draggedItem || draggedItem === targetOrder) return

		const draggedIndex = waypoints.findIndex(w => w.order === draggedItem)
		const targetIndex = waypoints.findIndex(w => w.order === targetOrder)
		
		const newWaypoints = [...waypoints]
		const draggedWaypoint = newWaypoints[draggedIndex]
		
		// 드래그된 항목 제거
		newWaypoints.splice(draggedIndex, 1)
		// 타겟 위치에 삽입
		newWaypoints.splice(targetIndex, 0, draggedWaypoint)
		
		// 순서 재정렬
		const reorderedWaypoints = newWaypoints.map((w, index) => ({ ...w, order: index + 1 }))
		setWaypoints(reorderedWaypoints)
		setDraggedItem(null)
	}

	const handleDragEnd = () => {
		setDraggedItem(null)
	}

	const submit = async () => {
		if (!canSubmit || !BACKEND_URL) return
		setLoading(true)
		setError(null)
		setResult(null)
		try {
			const requestBody = {
				start_lat: lat,
				start_lng: lng,
				total_distance_km: totalDistanceKm,
				waypoints: waypoints.filter(w => w.theme_keyword.trim().length > 0),
				is_round_trip: isRoundTrip
			}
			
			const r = await fetch(`${BACKEND_URL}/api/recommend`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(requestBody),
			})
			if (!r.ok) throw new Error(await r.text())
			const data = await r.json()
			setResult(data)
		} catch (e) {
			const errorText = await e.text ? await e.text() : String(e)
			if (errorText.includes('OPEN_MAP_AND_LOCAL')) {
				setError('Kakao Local API가 활성화되지 않았습니다. 카카오 개발자 콘솔에서 "OPEN_MAP_AND_LOCAL" 서비스를 활성화해주세요.')
			} else {
				setError(errorText)
			}
		} finally {
			setLoading(false)
		}
	}

	return (
		<div style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
			<h2>🏃‍♂️ 러닝 코스 랜덤 추천</h2>
			<MapPicker onPick={onPick} />
			
			<div style={{ marginTop: 16 }}>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
					<div>
						<label>총 러닝 거리 (km)</label>
						<input 
							type="number" 
							value={totalDistanceKm} 
							min={1} 
							step={0.5} 
							onChange={(e) => setTotalDistanceKm(Number(e.target.value))} 
							style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #ddd' }} 
						/>
					</div>
					<div>
						<label>왕복/편도</label>
						<div style={{ display: 'flex', gap: 20, marginTop: 4, justifyContent: 'center' }}>
							<label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
								<input 
									type="radio" 
									checked={isRoundTrip} 
									onChange={() => setIsRoundTrip(true)}
								/>
								왕복
							</label>
							<label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
								<input 
									type="radio" 
									checked={!isRoundTrip} 
									onChange={() => setIsRoundTrip(false)}
								/>
								편도
							</label>
						</div>
					</div>
				</div>

				<div style={{ marginBottom: 16 }}>
					<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
						<div>
							<label>경유지 설정</label>
							<div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
								드래그하여 순서를 변경할 수 있습니다
							</div>
						</div>
						<button 
							onClick={addWaypoint}
							style={{ 
								padding: '4px 12px', 
								backgroundColor: '#28a745', 
								color: 'white', 
								border: 'none', 
								borderRadius: 4,
								cursor: 'pointer'
							}}
						>
							+ 경유지 추가
						</button>
					</div>
					
					{waypoints.map((waypoint, index) => (
						<div 
							key={waypoint.order} 
							draggable
							onDragStart={(e) => handleDragStart(e, waypoint.order)}
							onDragOver={handleDragOver}
							onDrop={(e) => handleDrop(e, waypoint.order)}
							onDragEnd={handleDragEnd}
							style={{ 
								display: 'flex', 
								alignItems: 'center', 
								gap: 8, 
								marginBottom: 8,
								padding: 8,
								backgroundColor: draggedItem === waypoint.order ? '#e3f2fd' : '#f8f9fa',
								borderRadius: 4,
								cursor: 'move',
								border: draggedItem === waypoint.order ? '2px dashed #2196f3' : '1px solidrgb(6, 85, 163)',
								opacity: draggedItem === waypoint.order ? 0.7 : 1,
								transition: 'all 0.2s ease'
							}}
						>
							<span style={{ 
								minWidth: 20, 
								fontWeight: 'bold',
								color: 'rgb(25, 24, 24)',
								display: 'flex',
								alignItems: 'center',
								gap: 4
							}}>
								<span style={{ fontSize: 12 , color: 'rgb(87, 89, 90)'}}>⋮⋮</span>
								{waypoint.order}
							</span>
							<input 
								value={waypoint.theme_keyword}
								onChange={(e) => updateWaypoint(waypoint.order, e.target.value)}
								placeholder="경유지 키워드 (예: 카페, 맛집, 맥주)"
								style={{ flex: 1, padding: 8, borderRadius: 4, border: '1px solid #ddd' }}
								onMouseDown={(e) => e.stopPropagation()}
							/>
							<button 
								onClick={() => removeWaypoint(waypoint.order)}
								style={{ 
									padding: '4px 8px', 
									backgroundColor: 'rgb(13, 2, 4)', 
									color: 'white', 
									border: 'none', 
									borderRadius: 4,
									cursor: 'pointer'
								}}
							>
								×
							</button>
						</div>
					))}
				</div>

				<div style={{ textAlign: 'center' }}>
					<button 
						disabled={!canSubmit || loading} 
						onClick={submit} 
						style={{ 
							padding: '12px 24px', 
							backgroundColor: canSubmit && !loading ? '#007bff' : '#ccc', 
							color: 'white', 
							border: 'none', 
							borderRadius: 4,
							fontSize: 16,
							cursor: canSubmit && !loading ? 'pointer' : 'not-allowed'
						}}
					>
						{loading ? '추천중...' : '러닝 코스 추천 받기'}
					</button>
				</div>
			</div>

			{error && <div style={{ color: 'crimson', marginTop: 12, padding: 12, backgroundColor: '#f8d7da', borderRadius: 4 }}>{error}</div>}

			{result && (
				<div style={{ marginTop: 16, padding: 16, backgroundColor: '#f8f9fa', borderRadius: 8, border: '1px solid #e9ecef' }}>
					<div style={{ marginBottom: 12 }}>
						<h3 style={{ margin: '0 0 8px 0', color: '#333' }}>🏃‍♂️ 러닝 코스 추천 결과</h3>
						<div style={{ fontSize: 16, color: '#007bff', fontWeight: 'bold', marginBottom: 12 }}>
							목표 러닝 거리: <strong>{result.total_distance_km}km</strong> | 
							실제 총 거리: <strong>{result.actual_total_distance_km}km</strong> ({result.is_round_trip ? '왕복' : '편도'})
						</div>
						
						{result.waypoints && result.waypoints.length > 0 ? (
							<div>
								{result.waypoints.map((waypoint, index) => (
									<div key={waypoint.order} style={{ 
										marginBottom: 12, 
										padding: 12, 
										backgroundColor: 'white', 
										borderRadius: 4,
										border: '1px solid #dee2e6'
									}}>
										<div style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 4 }}>
											<span style={{ color: '#666' }}>📍 경유지 {waypoint.order}:</span> 
											<span style={{ color: '#000', marginLeft: 8 }}>{waypoint.place_name}</span>
										</div>
										<div style={{ fontSize: 14, color: '#666', marginBottom: 4 }}>
											테마: <strong>{waypoint.theme_keyword}</strong> | 
											거리: <strong>{waypoint.distance_km.toFixed(2)}km</strong>
										</div>
										{waypoint.address_name && (
											<div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
												주소: {waypoint.address_name}
											</div>
										)}
										{waypoint.phone && (
											<div style={{ fontSize: 12, color: '#888' }}>
												전화: {waypoint.phone}
											</div>
										)}
									</div>
								))}
								
								<div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
									검토된 장소: {result.candidates_considered}개 중 선택
								</div>
							</div>
						) : (
							<div style={{ color: '#666' }}>
								경유지를 찾을 수 없습니다. 다른 키워드나 거리를 시도해보세요.
							</div>
						)}
					</div>
					<a 
						href={result.route_url} 
						target="_blank" 
						rel="noreferrer"
						style={{ 
							display: 'inline-block',
							padding: '8px 16px',
							backgroundColor: '#007bff',
							color: 'white',
							textDecoration: 'none',
							borderRadius: 4,
							fontSize: 14
						}}
					>
						🗺️ 걷기 길찾기 열기
					</a>
				</div>
			)}
		</div>
	)
}
