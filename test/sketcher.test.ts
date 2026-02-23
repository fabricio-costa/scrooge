import { describe, it, expect } from "vitest";
import { generateSketch } from "../src/indexer/sketcher.js";
import type { Chunk } from "../src/indexer/chunkers/types.js";
import { estimateTokens } from "../src/utils/tokens.js";

function makeChunk(overrides: Partial<Chunk> & { kind: Chunk["kind"]; textRaw: string }): Chunk {
  return {
    id: "test-id",
    path: "test.kt",
    language: "kotlin",
    startLine: 1,
    endLine: 10,
    textSketch: "",
    tags: [],
    annotations: [],
    defines: [],
    uses: [],
    contentHash: "abc",
    ...overrides,
  };
}

// ── A. Class / ViewModel sketches ──────────────────────────────────────────────

describe("class/viewmodel sketches", () => {
  it("should extract property declarations and function signatures from a class", () => {
    const sketch = generateSketch(
      makeChunk({
        kind: "class",
        textRaw: `class UserManager {
    val users: List<User> = emptyList()
    private var isInitialized: Boolean = false

    fun loadUsers(): List<User> {
        return repository.getAll()
    }

    suspend fun refreshUsers() {
        val fresh = api.fetchUsers()
        // lots of implementation
    }
}`,
      }),
    );

    expect(sketch).toContain("val users: List<User>");
    expect(sketch).toContain("fun loadUsers()");
    expect(sketch).toContain("suspend fun refreshUsers()");
  });

  it("should include StateFlow properties in a viewmodel sketch", () => {
    const sketch = generateSketch(
      makeChunk({
        kind: "viewmodel",
        annotations: ["@HiltViewModel"],
        signature: "class LoginViewModel @Inject constructor(...) : ViewModel()",
        textRaw: `@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow<LoginUiState>(LoginUiState.Idle)
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    suspend fun authenticate(email: String, password: String): Boolean {
        _isLoading.value = true
        return try { authRepository.login(email, password).isSuccess } finally { _isLoading.value = false }
    }
}`,
      }),
    );

    expect(sketch).toContain("@HiltViewModel");
    expect(sketch).toContain("class LoginViewModel");
    expect(sketch).toContain("val uiState: StateFlow<LoginUiState>");
    expect(sketch).toContain("val isLoading: StateFlow<Boolean>");
    expect(sketch).toContain("suspend fun authenticate(email: String, password: String): Boolean");
  });
});

// ── B. Function sketches ───────────────────────────────────────────────────────

describe("function sketches", () => {
  it("should include the function signature when provided", () => {
    const sketch = generateSketch(
      makeChunk({
        kind: "function",
        signature: "fun validateEmail(email: String): Boolean",
        textRaw: `fun validateEmail(email: String): Boolean {
    return email.contains("@") && email.contains(".")
}`,
      }),
    );

    expect(sketch).toContain("fun validateEmail(email: String): Boolean");
  });

  it("should extract the signature from textRaw if signature field is absent", () => {
    const sketch = generateSketch(
      makeChunk({
        kind: "function",
        textRaw: `fun calculateTotal(items: List<Item>): Double {
    return items.sumOf { it.price }
}`,
      }),
    );

    expect(sketch).toContain("fun calculateTotal(items: List<Item>): Double");
  });

  it("should include @Composable annotation in composable sketches", () => {
    const sketch = generateSketch(
      makeChunk({
        kind: "composable",
        annotations: ["@Composable"],
        signature: "fun LoginScreen(viewModel: LoginViewModel, onLoginSuccess: () -> Unit)",
        textRaw: `@Composable
fun LoginScreen(
    viewModel: LoginViewModel = hiltViewModel(),
    onLoginSuccess: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    Column { Text("Hello") }
}`,
      }),
    );

    expect(sketch).toContain("@Composable");
    expect(sketch).toContain("fun LoginScreen");
  });
});

// ── C. API interface / DAO sketches ────────────────────────────────────────────

describe("api_interface/dao sketches", () => {
  it("should extract method signatures from an api_interface with HTTP annotations", () => {
    const sketch = generateSketch(
      makeChunk({
        kind: "api_interface",
        signature: "interface ApiService",
        textRaw: `interface ApiService {
    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): LoginResponse

    @GET("users/{id}")
    suspend fun getUser(@Path("id") userId: String): UserResponse

    @GET("users")
    suspend fun searchUsers(@Query("q") query: String): List<UserResponse>
}`,
      }),
    );

    expect(sketch).toContain("@POST");
    expect(sketch).toContain("suspend fun login");
    expect(sketch).toContain("@GET");
    expect(sketch).toContain("suspend fun getUser");
    expect(sketch).toContain("suspend fun searchUsers");
  });

  it("should extract method signatures from a DAO with @Query annotations", () => {
    const sketch = generateSketch(
      makeChunk({
        kind: "dao",
        signature: "interface UserDao",
        textRaw: `@Dao
interface UserDao {
    @Query("SELECT * FROM users WHERE id = :userId")
    suspend fun getUser(userId: String): UserEntity?

    @Query("SELECT * FROM users ORDER BY name ASC")
    suspend fun getAllUsers(): List<UserEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertUser(user: UserEntity)

    @Query("DELETE FROM users WHERE id = :userId")
    suspend fun deleteUser(userId: String)
}`,
      }),
    );

    expect(sketch).toContain("@Query");
    expect(sketch).toContain("suspend fun getUser");
    expect(sketch).toContain("suspend fun getAllUsers");
    expect(sketch).toContain("suspend fun upsertUser");
    expect(sketch).toContain("suspend fun deleteUser");
  });
});

// ── D. Entity sketches ─────────────────────────────────────────────────────────

describe("entity sketches", () => {
  it("should extract fields with @ColumnInfo and @PrimaryKey annotations", () => {
    const sketch = generateSketch(
      makeChunk({
        kind: "entity",
        signature: "data class UserEntity",
        textRaw: `@Entity(tableName = "users")
data class UserEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "user_name") val name: String,
    val email: String,
    var avatarUrl: String?,
    val lastSyncedAt: Long = System.currentTimeMillis()
)`,
      }),
    );

    expect(sketch).toContain("@PrimaryKey val id: String");
    expect(sketch).toContain("@ColumnInfo");
    expect(sketch).toContain("val name: String");
    expect(sketch).toContain("val email: String");
    expect(sketch).toContain("var avatarUrl: String?");
  });
});

// ── E. Token budget enforcement ────────────────────────────────────────────────

describe("token budget enforcement", () => {
  it("should not exceed sketchMaxTokens for a large class chunk", () => {
    // Build a chunk with >5000 chars of raw text
    const methods = Array.from({ length: 50 }, (_, i) =>
      `    suspend fun method${i}(param: String): Result<Unit> {\n        repository.call${i}(param)\n        logger.log("method${i} called")\n        return Result.success(Unit)\n    }`,
    ).join("\n\n");

    const textRaw = `class HugeViewModel : ViewModel() {\n${methods}\n}`;
    expect(textRaw.length).toBeGreaterThan(5000);

    const sketch = generateSketch(
      makeChunk({
        kind: "class",
        textRaw,
      }),
    );

    expect(estimateTokens(sketch)).toBeLessThanOrEqual(200);
  });

  it("should not exceed sketchMaxTokens for a large function chunk", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `    val x${i} = compute(${i})`).join("\n");
    const textRaw = `fun massiveFunction(): Int {\n${lines}\n    return x0\n}`;
    expect(textRaw.length).toBeGreaterThan(5000);

    const sketch = generateSketch(
      makeChunk({
        kind: "function",
        textRaw,
      }),
    );

    expect(estimateTokens(sketch)).toBeLessThanOrEqual(200);
  });
});

// ── F. Doc comment extraction ──────────────────────────────────────────────────

describe("doc comment extraction", () => {
  it("should include KDoc comments (/** ... */) in the sketch", () => {
    const sketch = generateSketch(
      makeChunk({
        kind: "function",
        signature: "fun authenticate(email: String, password: String): Boolean",
        textRaw: `/**
 * Authenticate user with email and password.
 * @param email User email
 * @param password User password
 */
suspend fun authenticate(email: String, password: String): Boolean {
    return repo.login(email, password).isSuccess
}`,
      }),
    );

    expect(sketch).toContain("/**");
    expect(sketch).toContain("Authenticate user with email and password.");
    expect(sketch).toContain("@param email");
  });

  it("should include /// doc comments in the sketch", () => {
    const sketch = generateSketch(
      makeChunk({
        kind: "function",
        signature: "fun sum(a: Int, b: Int): Int",
        textRaw: `/// Adds two integers.
/// Returns the sum.
fun sum(a: Int, b: Int): Int {
    return a + b
}`,
      }),
    );

    expect(sketch).toContain("/// Adds two integers.");
    expect(sketch).toContain("/// Returns the sum.");
  });
});

// ── G. Empty / fallback behavior ───────────────────────────────────────────────

describe("empty/fallback behavior", () => {
  it("should produce a non-empty sketch for a chunk with no signature, annotations, or docs", () => {
    const sketch = generateSketch(
      makeChunk({
        kind: "generic_block",
        textRaw: `val x = 42
val y = x * 2
println(y)`,
      }),
    );

    expect(sketch.trim().length).toBeGreaterThan(0);
    // Falls back to truncated raw text
    expect(sketch).toContain("val x = 42");
  });

  it("should fallback to raw text for a generic_file chunk", () => {
    const sketch = generateSketch(
      makeChunk({
        kind: "generic_file",
        textRaw: "some arbitrary content without any recognizable structure",
      }),
    );

    expect(sketch.trim().length).toBeGreaterThan(0);
    expect(sketch).toContain("some arbitrary content");
  });
});

// ── H. Gradle / XML chunk types ────────────────────────────────────────────────

describe("gradle/xml chunk types", () => {
  it("should produce a sketch from a gradle_dependencies chunk within budget", () => {
    const deps = Array.from({ length: 30 }, (_, i) =>
      `    implementation("com.example:lib-${i}:1.0.${i}")`,
    ).join("\n");
    const textRaw = `dependencies {\n${deps}\n}`;

    const sketch = generateSketch(
      makeChunk({
        kind: "gradle_dependencies",
        language: "gradle",
        path: "build.gradle.kts",
        textRaw,
      }),
    );

    expect(sketch.trim().length).toBeGreaterThan(0);
    expect(estimateTokens(sketch)).toBeLessThanOrEqual(200);
  });

  it("should produce a sketch from a layout chunk within budget", () => {
    const textRaw = `<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">

    <TextView
        android:id="@+id/title"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Hello World" />

    <Button
        android:id="@+id/submitBtn"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="Submit" />
</LinearLayout>`;

    const sketch = generateSketch(
      makeChunk({
        kind: "layout",
        language: "xml",
        path: "activity_main.xml",
        textRaw,
      }),
    );

    expect(sketch.trim().length).toBeGreaterThan(0);
    expect(estimateTokens(sketch)).toBeLessThanOrEqual(200);
  });
});
