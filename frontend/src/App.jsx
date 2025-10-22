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
	const [distanceKm, setDistanceKm] = useState(5)
	const [theme, setTheme] = useState('카페')
	const [loading, setLoading] = useState(false)
	const [result, setResult] = useState(null)
	const [error, setError] = useState(null)

	const canSubmit = lat !== null && lng !== null && distanceKm > 0 && theme.trim().length > 0

	const onPick = useCallback((la, ln) => {
		setLat(la)
		setLng(ln)
	}, [])

	const submit = async () => {
		if (!canSubmit || !BACKEND_URL) return
		setLoading(true)
		setError(null)
		setResult(null)
		try {
			const r = await fetch(`${BACKEND_URL}/api/recommend`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ start_lat: lat, start_lng: lng, distance_km: distanceKm, theme_keyword: theme }),
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
			<h2>러닝 코스 랜덤 추천</h2>
			<MapPicker onPick={onPick} />
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
				<div>
					<label>러닝 거리 (km)</label>
					<input type="number" value={distanceKm} min={0.5} step={0.5} onChange={(e) => setDistanceKm(Number(e.target.value))} style={{ width: '100%' }} />
				</div>
				<div>
					<label>테마</label>
					<input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="맥주 / 카페 / 맛집" style={{ width: '100%' }} />
				</div>
				<div style={{ alignSelf: 'end' }}>
					<button disabled={!canSubmit || loading} onClick={submit} style={{ width: '100%' }}>
						{loading ? '추천중...' : '추천 받기'}
					</button>
				</div>
			</div>

			{error && <div style={{ color: 'crimson', marginTop: 12 }}>{error}</div>}

			{result && (
				<div style={{ marginTop: 16, padding: 16, backgroundColor: '#f8f9fa', borderRadius: 8, border: '1px solid #e9ecef' }}>
					<div style={{ marginBottom: 12 }}>
						<h3 style={{ margin: '0 0 8px 0', color: '#333' }}>🏃‍♂️ 러닝 코스 추천</h3>
						{result.selected_place ? (
							<div>
								<div style={{ fontSize: 18, color: '#666',fontWeight: 'bold', marginBottom: 8 }}>
									📍 {result.selected_place.place_name}
								</div>
								<div style={{ fontSize: 14, color: '#666', marginBottom: 4 }}>
									편도 거리: <strong>{result.selected_place.distance_km}km</strong>
								</div>
								<div style={{ fontSize: 14, color: '#007bff', marginBottom: 4, fontWeight: 'bold' }}>
									왕복 러닝 거리: <strong>{(result.selected_place.distance_km * 2).toFixed(1)}km</strong> (목표: {distanceKm}km)
								</div>
								{result.selected_place.address_name && (
									<div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
										주소: {result.selected_place.address_name}
									</div>
								)}
								{result.selected_place.phone && (
									<div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
										전화: {result.selected_place.phone}
									</div>
								)}
								<div style={{ fontSize: 12, color: '#666' }}>
									검토된 장소: {result.candidates_considered}개 중 선택
								</div>
							</div>
						) : (
							<div style={{ color: '#666' }}>
								해당 지역에서 '{theme}' 테마의 장소를 찾을 수 없습니다.
								다른 테마나 거리를 시도해보세요.
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
