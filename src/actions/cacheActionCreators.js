export function cacheSet({ queries, responses }) {
	return {
		type: 'CACHE_SET',
		payload: { queries, responses },
	};
}

export function cacheRequest(queries) {
	return {
		type: 'CACHE_REQUEST',
		payload: queries
	};
}

export function cacheSuccess({ queries, responses }) {
	return {
		type: 'CACHE_SUCCESS',
		payload: { queries, responses }
	};
}

export function cacheClear() {
	return {
		type: 'CACHE_CLEAR',
	};
}

