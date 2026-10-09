#include "ep_weather_provider_open.h"
#include "resource.h"
#include <stdio.h>

typedef struct _EPWBuf
{
    WCHAR* p;
    size_t len;
    size_t cap;
    BOOL bFailed;
} EPWBuf;

static BOOL epw_Buf_Reserve(EPWBuf* b, size_t extra)
{
    if (b->bFailed) return FALSE;
    size_t need = b->len + extra + 1;
    if (need > b->cap)
    {
        size_t cap = b->cap ? b->cap : 4096;
        while (cap < need) cap *= 2;
        WCHAR* p = realloc(b->p, cap * sizeof(WCHAR));
        if (!p)
        {
            b->bFailed = TRUE;
            return FALSE;
        }
        b->p = p;
        b->cap = cap;
    }
    return TRUE;
}

static void epw_Buf_Append(EPWBuf* b, LPCWSTR s, size_t cch)
{
    if (!epw_Buf_Reserve(b, cch)) return;
    memcpy(b->p + b->len, s, cch * sizeof(WCHAR));
    b->len += cch;
    b->p[b->len] = 0;
}

static void epw_Buf_AppendZ(EPWBuf* b, LPCWSTR s)
{
    epw_Buf_Append(b, s, wcslen(s));
}

static void epw_Buf_AppendInt(EPWBuf* b, LONG64 value)
{
    WCHAR wsz[32];
    swprintf_s(wsz, 32, L"%lld", value);
    epw_Buf_AppendZ(b, wsz);
}

// Appends a JSON string literal. '<' is escaped as well so that a value can never contain "</script>".
static void epw_Buf_AppendJsonString(EPWBuf* b, LPCWSTR s)
{
    WCHAR wszEscape[8];
    epw_Buf_AppendZ(b, L"\"");
    for (; *s; s++)
    {
        switch (*s)
        {
        case L'"':
            epw_Buf_AppendZ(b, L"\\\"");
            break;
        case L'\\':
            epw_Buf_AppendZ(b, L"\\\\");
            break;
        case L'<':
            epw_Buf_AppendZ(b, L"\\u003c");
            break;
        default:
            if (*s < 0x20)
            {
                swprintf_s(wszEscape, 8, L"\\u%04x", (unsigned int)*s);
                epw_Buf_AppendZ(b, wszEscape);
            }
            else
            {
                epw_Buf_Append(b, s, 1);
            }
            break;
        }
    }
    epw_Buf_AppendZ(b, L"\"");
}

static void epw_Buf_AppendBase64(EPWBuf* b, const BYTE* pData, DWORD cbData)
{
    static const WCHAR wszTable[] = L"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (DWORD i = 0; i < cbData; i += 3)
    {
        BOOL bHave2 = (i + 1 < cbData);
        BOOL bHave3 = (i + 2 < cbData);
        DWORD v = ((DWORD)pData[i] << 16) | (bHave2 ? ((DWORD)pData[i + 1] << 8) : 0) | (bHave3 ? (DWORD)pData[i + 2] : 0);
        WCHAR wszQuad[4];
        wszQuad[0] = wszTable[(v >> 18) & 63];
        wszQuad[1] = wszTable[(v >> 12) & 63];
        wszQuad[2] = bHave2 ? wszTable[(v >> 6) & 63] : L'=';
        wszQuad[3] = bHave3 ? wszTable[v & 63] : L'=';
        epw_Buf_Append(b, wszQuad, 4);
    }
}

static BOOL epw_Open_GetResource(UINT id, const BYTE** ppData, DWORD* pcbData)
{
    HRSRC hRes = FindResourceW(epw_hModule, MAKEINTRESOURCEW(id), RT_RCDATA);
    if (!hRes) return FALSE;
    HGLOBAL hGlobal = LoadResource(epw_hModule, hRes);
    if (!hGlobal) return FALSE;
    *ppData = (const BYTE*)LockResource(hGlobal);
    *pcbData = SizeofResource(epw_hModule, hRes);
    return *ppData && *pcbData;
}

// Loads a UTF-8 text resource as a malloc'ed UTF-16 string.
static LPWSTR epw_Open_LoadText(UINT id)
{
    const BYTE* pData = NULL;
    DWORD cbData = 0;
    if (!epw_Open_GetResource(id, &pData, &cbData))
    {
        printf("[Open provider] Resource %u is missing.\n", id);
        return NULL;
    }
    if (cbData >= 3 && pData[0] == 0xEF && pData[1] == 0xBB && pData[2] == 0xBF)
    {
        pData += 3;
        cbData -= 3;
    }
    int cch = MultiByteToWideChar(CP_UTF8, 0, (LPCCH)pData, cbData, NULL, 0);
    if (cch <= 0) return NULL;
    WCHAR* wsz = malloc(((size_t)cch + 1) * sizeof(WCHAR));
    if (!wsz) return NULL;
    MultiByteToWideChar(CP_UTF8, 0, (LPCCH)pData, cbData, wsz, cch);
    wsz[cch] = 0;
    return wsz;
}

// Names must match ICON_KEYS in provider_open\providers.js and the files in provider_open\icons\.
static const struct
{
    LPCWSTR wszName;
    UINT id;
} epw_Open_Icons[] = {
    { L"clear-day", IDR_EPW_ICON_CLEAR_DAY },
    { L"clear-night", IDR_EPW_ICON_CLEAR_NIGHT },
    { L"partly-day", IDR_EPW_ICON_PARTLY_DAY },
    { L"partly-night", IDR_EPW_ICON_PARTLY_NIGHT },
    { L"cloudy", IDR_EPW_ICON_CLOUDY },
    { L"fog", IDR_EPW_ICON_FOG },
    { L"drizzle", IDR_EPW_ICON_DRIZZLE },
    { L"rain", IDR_EPW_ICON_RAIN },
    { L"heavy-rain", IDR_EPW_ICON_HEAVY_RAIN },
    { L"thunder", IDR_EPW_ICON_THUNDER },
    { L"snow", IDR_EPW_ICON_SNOW },
    { L"sleet", IDR_EPW_ICON_SLEET },
};

static void epw_Open_AppendIcons(EPWBuf* b)
{
    epw_Buf_AppendZ(b, L"window.EP_ICONS={");
    for (int i = 0; i < ARRAYSIZE(epw_Open_Icons); i++)
    {
        const BYTE* pData = NULL;
        DWORD cbData = 0;
        if (!epw_Open_GetResource(epw_Open_Icons[i].id, &pData, &cbData))
        {
            printf("[Open provider] Icon resource %u is missing.\n", epw_Open_Icons[i].id);
            continue;
        }
        epw_Buf_AppendJsonString(b, epw_Open_Icons[i].wszName);
        epw_Buf_AppendZ(b, L":\"data:image/png;base64,");
        epw_Buf_AppendBase64(b, pData, cbData);
        epw_Buf_AppendZ(b, L"\",");
    }
    epw_Buf_AppendZ(b, L"};\n");
}

static void epw_Open_AppendConfig(EPWeather* _this, EPWBuf* b)
{
    WCHAR wszTerm[MAX_PATH];
    WCHAR wszLanguage[MAX_PATH];
    WCHAR wszApiKey[EP_WEATHER_APIKEY_MAX];

    LONG64 dwProvider = InterlockedAdd64(&_this->dwProvider, 0);
    if (dwProvider < 0 || dwProvider >= EP_WEATHER_NUM_PROVIDERS) dwProvider = EP_WEATHER_PROVIDER_OPENMETEO;

    wcsncpy_s(wszTerm, MAX_PATH, _this->wszTerm, _TRUNCATE);
    wcsncpy_s(wszLanguage, MAX_PATH, _this->wszLanguage, _TRUNCATE);
    AcquireSRWLockShared(&_this->lockApiKeys);
    wcsncpy_s(wszApiKey, EP_WEATHER_APIKEY_MAX, _this->wszApiKeys[dwProvider], _TRUNCATE);
    ReleaseSRWLockShared(&_this->lockApiKeys);

    epw_Buf_AppendZ(b, L"window.EP_CFG={\"provider\":");
    epw_Buf_AppendInt(b, dwProvider);
    epw_Buf_AppendZ(b, L",\"term\":");
    epw_Buf_AppendJsonString(b, wszTerm);
    epw_Buf_AppendZ(b, L",\"lang\":");
    epw_Buf_AppendJsonString(b, wszLanguage[0] ? wszLanguage : L"en");
    epw_Buf_AppendZ(b, L",\"unit\":");
    epw_Buf_AppendJsonString(b, InterlockedAdd64(&_this->dwTemperatureUnit, 0) == EP_WEATHER_TUNIT_FAHRENHEIT ? L"F" : L"C");
    epw_Buf_AppendZ(b, L",\"apiKey\":");
    epw_Buf_AppendJsonString(b, wszApiKey);
    epw_Buf_AppendZ(b, L",\"geo\":");
    epw_Buf_AppendZ(b, InterlockedAdd64(&_this->dwGeolocationMode, 0) ? L"true" : L"false");
    epw_Buf_AppendZ(b, L",\"iconSize\":");
    epw_Buf_AppendInt(b, InterlockedAdd64(&_this->cbx, 0));
    epw_Buf_AppendZ(b, L",\"textScale\":");
    epw_Buf_AppendInt(b, epw_Weather_GetTextScaleFactor(_this));
    epw_Buf_AppendZ(b, L"};\n");

    SecureZeroMemory(wszApiKey, sizeof(wszApiKey));
}

LPWSTR epw_Open_BuildPage(EPWeather* _this)
{
    static const WCHAR wszMarker[] = L"<!--EP_SCRIPT-->";

    EPWBuf b = { 0 };
    LPWSTR wszHtml = epw_Open_LoadText(IDR_EPW_OPEN_HTML);
    LPWSTR wszProviders = epw_Open_LoadText(IDR_EPW_OPEN_PROVIDERS_JS);
    LPWSTR wszUi = epw_Open_LoadText(IDR_EPW_OPEN_UI_JS);

    if (wszHtml && wszProviders && wszUi)
    {
        LPWSTR pMarker = wcsstr(wszHtml, wszMarker);
        if (pMarker)
        {
            epw_Buf_Append(&b, wszHtml, pMarker - wszHtml);
            epw_Buf_AppendZ(&b, L"<script>\n");
            epw_Open_AppendConfig(_this, &b);
            epw_Open_AppendIcons(&b);
            epw_Buf_AppendZ(&b, L"</script>\n<script>\n");
            epw_Buf_AppendZ(&b, wszProviders);
            epw_Buf_AppendZ(&b, L"\n</script>\n<script>\n");
            epw_Buf_AppendZ(&b, wszUi);
            epw_Buf_AppendZ(&b, L"\n</script>\n");
            epw_Buf_AppendZ(&b, pMarker + ARRAYSIZE(wszMarker) - 1);
        }
        else
        {
            printf("[Open provider] The page template has no script marker.\n");
        }
    }

    free(wszHtml);
    free(wszProviders);
    free(wszUi);

    if (b.bFailed)
    {
        free(b.p);
        return NULL;
    }
    return b.p;
}
