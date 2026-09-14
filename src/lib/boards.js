// 게시판 공통 설정 (2026-09-14 게시판 정비).
// 목록은 한 줄 행으로 보여주고, 누르면 /post/:board/:id 상세 페이지(src/pages/PostDetail.jsx)로 들어간다.
// 상세 페이지·수정 폼·댓글이 여기 설정만 보고 동작하도록 게시판별 차이를 한 곳에 모은다.
import { companionApi, qnaApi, reviewsApi, crewApi, destinationsApi } from './db';

export const BOARDS = {
  companion: {
    key: 'companion', label: '여행 동행자 모집', listPath: '/companion', api: companionApi,
    likeTable: 'companion_posts', reportType: 'companion',
    titleField: 'title', bodyField: 'content', imageField: null, comments: null,
    hasRegion: true, hasStatus: true,
  },
  review: {
    key: 'review', label: '여행 후기', listPath: '/qna', api: reviewsApi,
    likeTable: 'reviews', reportType: 'review',
    titleField: 'title', bodyField: 'description', imageField: 'image_url', comments: reviewsApi,
    hasRegion: true,
  },
  qna: {
    key: 'qna', label: 'Q&A', listPath: '/qna?tab=qna', api: qnaApi,
    likeTable: 'qna_posts', reportType: 'qna',
    titleField: 'title', bodyField: 'content', imageField: null, comments: qnaApi,
    hasRegion: false,
  },
  free: {
    key: 'free', label: '자유게시판', listPath: '/qna?tab=free', api: qnaApi,
    likeTable: 'qna_posts', reportType: 'qna',
    titleField: 'title', bodyField: 'content', imageField: null, comments: qnaApi,
    hasRegion: false,
  },
  crew: {
    key: 'crew', label: 'CREW 전용', listPath: '/crew', api: crewApi,
    likeTable: 'crew_posts', reportType: 'crew',
    titleField: 'title', bodyField: 'content', imageField: 'image_url', comments: null,
    hasRegion: false, crewOnly: true,
  },
  destination: {
    key: 'destination', label: '승무원 추천지', listPath: '/recommend', api: destinationsApi,
    likeTable: 'destinations', reportType: 'destination',
    titleField: 'name', bodyField: 'description', extraField: 'crew_comment', extraLabel: '승무원 꿀팁',
    imageField: 'image_url', comments: null,
    hasRegion: true, crewOnly: false, crewWriteOnly: true,
  },
};

export const postPath = (board, id) => `/post/${board}/${id}`;

// 동행 모집 상태(companion_posts.status)
export const COMPANION_STATUS = { open: '모집중', closed: '모집완료' };
