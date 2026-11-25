use crate::credentials::SessionCredential;
use reqwest::{blocking::Client, Method, StatusCode};
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::{json, Value};
use std::time::Duration;
use url::Url;
use uuid::Uuid;

const USER_AGENT: &str = "AscentFocusWindows/0.1.0";

#[derive(Clone, Debug)]
pub struct ApiError {
    pub message: String,
    pub unauthorized: bool,
}

impl ApiError {
    fn from_status(status: StatusCode, body: &str) -> Self {
        let message = serde_json::from_str::<ErrorEnvelope>(body)
            .ok()
            .and_then(|envelope| envelope.error.map(|error| error.message))
            .filter(|message| !message.trim().is_empty())
            .unwrap_or_else(|| match status {
                StatusCode::UNAUTHORIZED => "Sign in again to reconnect this widget".to_string(),
                StatusCode::FORBIDDEN => {
                    "The server rejected this change. Refresh and try again".to_string()
                }
                StatusCode::TOO_MANY_REQUESTS => {
                    "The server is busy. Try again in a moment".to_string()
                }
                _ => format!("The Ascent server returned HTTP {}", status.as_u16()),
            });
        Self {
            message,
            unauthorized: status == StatusCode::UNAUTHORIZED,
        }
    }
}

#[derive(Deserialize)]
struct ErrorEnvelope {
    error: Option<ApiErrorBody>,
}
#[derive(Deserialize)]
struct ApiErrorBody {
    message: String,
}

#[derive(Clone)]
pub struct ApiClient {
    base_url: Url,
    http: Client,
    session: Option<SessionCredential>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FocusEnvelope {
    session: Option<FocusSession>,
    #[serde(default)]
    #[allow(dead_code)]
    today_minutes: Option<f64>,
    #[serde(default)]
    block_completed: bool,
    #[serde(default)]
    task_auto_completed: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSession {
    pub id: String,
    pub status: String,
    pub elapsed_ms: i64,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub task_source: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub task_title: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct FocusActionResult {
    pub session: Option<FocusSession>,
    pub block_completed: bool,
    pub task_auto_completed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuestEnvelope {
    quests: Vec<Quest>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Quest {
    id: String,
    title: String,
    status: String,
    tier_done: Option<String>,
    progress: f64,
    target_json: String,
    ref_type: Option<String>,
    ref_id: Option<String>,
    habit_id: Option<String>,
}
#[derive(Debug, Deserialize)]
struct QuestTarget {
    metric: String,
    standard: f64,
}

#[derive(Debug, Deserialize)]
struct CourseEnvelope {
    courses: Vec<Course>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Course {
    id: String,
    title: String,
    subject_id: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CourseDetailEnvelope {
    course: Course,
    lessons: Vec<Lesson>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Lesson {
    id: String,
    no: i32,
    title: String,
    status: String,
    chapter_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct PersonalTaskEnvelope {
    tasks: Vec<PersonalTask>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersonalTask {
    id: String,
    title: String,
    status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub share_task_titles_with_ai: bool,
}

#[derive(Clone, Debug)]
pub struct WidgetTask {
    pub id: String,
    pub title: String,
    pub detail: String,
    pub source: TaskSource,
    pub subject_id: String,
    pub chapter_id: String,
    pub done: bool,
    pub can_complete: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskSource {
    Today,
    Courses,
    Mine,
    Ai,
}

impl TaskSource {
    pub fn label(self) -> &'static str {
        match self {
            Self::Today => "Today",
            Self::Courses => "Courses",
            Self::Mine => "Mine",
            Self::Ai => "AI",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionEnvelope {
    pub suggestion: SuggestionResponse,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionResponse {
    pub provider: String,
    pub suggestion: SuggestedTask,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedTask {
    pub title: String,
    pub reason: String,
    pub estimated_minutes: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginEnvelope {
    token: String,
    csrf_token: String,
    user_id: String,
    username: String,
    expires_at: String,
}

impl ApiClient {
    pub fn new(server: &str, session: Option<SessionCredential>) -> Result<Self, String> {
        let mut base_url =
            Url::parse(server.trim()).map_err(|_| "Enter a valid server URL".to_string())?;
        if !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.query().is_some()
            || base_url.fragment().is_some()
        {
            return Err(
                "The server URL must not contain a username, password, query, or fragment"
                    .to_string(),
            );
        }
        let host = base_url.host_str().unwrap_or_default();
        let loopback = host.eq_ignore_ascii_case("localhost")
            || host == "127.0.0.1"
            || host == "::1"
            || host == "[::1]";
        if base_url.scheme() != "https" && !(base_url.scheme() == "http" && loopback) {
            return Err(
                "Use HTTPS for remote servers. HTTP is allowed only for localhost".to_string(),
            );
        }
        if !base_url.path().ends_with('/') {
            let path = format!("{}/", base_url.path());
            base_url.set_path(&path);
        }
        let http = Client::builder()
            .timeout(Duration::from_secs(12))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(USER_AGENT)
            .build()
            .map_err(|_| "Could not initialize secure server communication".to_string())?;
        Ok(Self {
            base_url,
            http,
            session,
        })
    }

    fn endpoint(&self, path: &str) -> Result<Url, ApiError> {
        self.base_url.join(path).map_err(|_| ApiError {
            message: "Invalid Ascent API path".to_string(),
            unauthorized: false,
        })
    }

    fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        payload: Option<Value>,
    ) -> Result<T, ApiError> {
        let url = self.endpoint(path)?;
        let mut request = self
            .http
            .request(method.clone(), url)
            .header("accept", "application/json");
        if let Some(session) = &self.session {
            request = request.header(
                "cookie",
                format!(
                    "ascent_session={}; ascent_csrf={}",
                    session.token, session.csrf_token
                ),
            );
            if method != Method::GET && method != Method::HEAD {
                request = request.header("x-csrf-token", session.csrf_token.as_str());
            }
        }
        if let Some(payload) = payload {
            request = request.json(&payload);
        }
        let response = request.send().map_err(|_| ApiError {
            message: "Could not reach the Ascent server. Check the URL and connection".to_string(),
            unauthorized: false,
        })?;
        let status = response.status();
        let body = response.text().map_err(|_| ApiError {
            message: "Could not read the Ascent server response".to_string(),
            unauthorized: false,
        })?;
        if !status.is_success() {
            return Err(ApiError::from_status(status, &body));
        }
        serde_json::from_str(&body).map_err(|_| ApiError {
            message: "The Ascent server returned an unreadable response".to_string(),
            unauthorized: false,
        })
    }

    pub fn sign_in(&self, username: &str, password: &str) -> Result<SessionCredential, ApiError> {
        let response: LoginEnvelope = self.request(
            Method::POST,
            "api/auth/native",
            Some(json!({"username": username, "password": password})),
        )?;
        Ok(SessionCredential {
            token: response.token,
            csrf_token: response.csrf_token,
            user_id: response.user_id,
            username: response.username,
            expires_at: response.expires_at,
        })
    }

    pub fn logout(&self) -> Result<(), ApiError> {
        let _: Value = self.request(Method::POST, "api/auth/logout", Some(json!({})))?;
        Ok(())
    }

    pub fn focus(&self) -> Result<Option<FocusSession>, ApiError> {
        let response: FocusEnvelope = self.request(Method::GET, "api/focus", None)?;
        Ok(response.session.filter(|session| session.status != "ended"))
    }

    pub fn focus_action(
        &self,
        action: &str,
        task: Option<&WidgetTask>,
        fallback_kind: &str,
    ) -> Result<FocusActionResult, ApiError> {
        let mut payload = json!({ "action": action });
        if action == "start" {
            payload["kind"] = json!(fallback_kind);
            payload["subjectId"] =
                json!(task.and_then(
                    |item| (!item.subject_id.is_empty()).then_some(item.subject_id.as_str())
                ));
            payload["chapterId"] =
                json!(task.and_then(
                    |item| (!item.chapter_id.is_empty()).then_some(item.chapter_id.as_str())
                ));
            payload["taskTitle"] = json!(task.map(|item| item.title.as_str()));
            payload["taskSource"] = json!(task.map(|item| item.source.label()));
            payload["taskId"] = json!(task
                .filter(|item| item.source != TaskSource::Ai)
                .map(|item| item.id.as_str()));
            payload["clientRequestId"] = json!(Uuid::new_v4().to_string());
        }
        let response: FocusEnvelope = self.request(Method::POST, "api/focus", Some(payload))?;
        Ok(FocusActionResult {
            session: response.session.filter(|session| session.status != "ended"),
            block_completed: response.block_completed,
            task_auto_completed: response.task_auto_completed,
        })
    }

    pub fn complete_focus_block(&self, session_id: &str) -> Result<FocusActionResult, ApiError> {
        let response: FocusEnvelope = self.request(
            Method::POST,
            "api/focus",
            Some(json!({ "action": "complete-block", "sessionId": session_id })),
        )?;
        Ok(FocusActionResult {
            session: response.session.filter(|session| session.status != "ended"),
            block_completed: response.block_completed,
            task_auto_completed: response.task_auto_completed,
        })
    }

    pub fn load_tasks(&self) -> Result<(Vec<WidgetTask>, Preferences), ApiError> {
        let quests: QuestEnvelope = self.request(Method::GET, "api/quests", None)?;
        let courses: CourseEnvelope = self.request(Method::GET, "api/courses", None)?;
        let personal: PersonalTaskEnvelope =
            self.request(Method::GET, "api/personal-tasks", None)?;
        let preferences: Preferences = self.request(Method::GET, "api/prefs", None)?;
        let mut tasks = Vec::new();

        for quest in quests
            .quests
            .into_iter()
            .filter(|quest| quest.status == "open")
        {
            let target = serde_json::from_str::<QuestTarget>(&quest.target_json).ok();
            let metric = target
                .as_ref()
                .map(|target| target.metric.as_str())
                .unwrap_or("minutes");
            let value = target.as_ref().map(|target| target.standard).unwrap_or(0.0);
            let detail = if quest.habit_id.is_some() {
                format!("Habit · {:.0}/{:.0}", quest.progress, value)
            } else {
                format!("Tracked by {} · {:.0}/{:.0}", metric, quest.progress, value)
            };
            let chapter_id = if quest.ref_type.as_deref() == Some("chapter") {
                quest.ref_id.clone().unwrap_or_default()
            } else {
                String::new()
            };
            let subject_id = match quest.ref_type.as_deref() {
                Some("subject") => quest.ref_id.clone().unwrap_or_default(),
                Some("chapter") => chapter_id
                    .rsplit_once('-')
                    .map(|(prefix, _)| prefix.to_string())
                    .unwrap_or_default(),
                _ => String::new(),
            };
            tasks.push(WidgetTask {
                id: quest.id,
                title: quest.title,
                detail,
                source: TaskSource::Today,
                subject_id,
                chapter_id,
                done: quest.tier_done.is_some(),
                can_complete: quest.habit_id.is_some() || metric == "check",
            });
        }

        for course in courses.courses {
            let path = format!("api/courses/{}", course.id);
            let detail: CourseDetailEnvelope = self.request(Method::GET, &path, None)?;
            for lesson in detail
                .lessons
                .into_iter()
                .filter(|lesson| lesson.status != "done")
                .take(20)
            {
                tasks.push(WidgetTask {
                    id: lesson.id,
                    title: lesson.title,
                    detail: format!("{} · Lesson {}", detail.course.title, lesson.no),
                    source: TaskSource::Courses,
                    subject_id: detail.course.subject_id.clone(),
                    chapter_id: lesson.chapter_ids.first().cloned().unwrap_or_default(),
                    done: false,
                    can_complete: true,
                });
            }
        }

        for task in personal
            .tasks
            .into_iter()
            .filter(|task| task.status == "open")
        {
            tasks.push(WidgetTask {
                id: task.id,
                title: task.title,
                detail: "Personal task".to_string(),
                source: TaskSource::Mine,
                subject_id: String::new(),
                chapter_id: String::new(),
                done: task.status == "done",
                can_complete: true,
            });
        }
        Ok((tasks, preferences))
    }

    pub fn complete_task(
        &self,
        task: &WidgetTask,
        client_request_id: &str,
    ) -> Result<(), ApiError> {
        let (method, path, body) = match task.source {
            TaskSource::Today => (
                Method::POST,
                format!("api/quests/{}", task.id),
                json!({"tier":"standard"}),
            ),
            TaskSource::Courses => (
                Method::PATCH,
                format!("api/lessons/{}", task.id),
                json!({"status":"done"}),
            ),
            TaskSource::Mine => (
                Method::PATCH,
                format!("api/personal-tasks/{}", task.id),
                json!({"status":"done", "clientRequestId": client_request_id}),
            ),
            TaskSource::Ai => {
                return Err(ApiError {
                    message: "Add an AI suggestion to Mine before completing it".to_string(),
                    unauthorized: false,
                });
            }
        };
        let _: Value = self.request(method, &path, Some(body))?;
        Ok(())
    }

    pub fn create_personal_task(
        &self,
        title: &str,
        client_request_id: &str,
    ) -> Result<(), ApiError> {
        let _: Value = self.request(
            Method::POST,
            "api/personal-tasks",
            Some(json!({"title": title, "clientRequestId": client_request_id})),
        )?;
        Ok(())
    }

    pub fn set_title_sharing(&self, allow: bool) -> Result<Preferences, ApiError> {
        let _: Value = self.request(
            Method::PATCH,
            "api/prefs",
            Some(json!({"shareTaskTitlesWithAi": allow})),
        )?;
        self.request(Method::GET, "api/prefs", None)
    }

    pub fn suggest_task(&self) -> Result<SuggestionResponse, ApiError> {
        let response: SuggestionEnvelope = self.request(
            Method::POST,
            "api/ai",
            Some(json!({"action":"suggest_tasks"})),
        )?;
        Ok(response.suggestion)
    }
}
