#include "circuit/protocol.hpp"

#include <charconv>
#include <cctype>

namespace circuit::protocol {
namespace {

std::size_t skipWhitespace(std::string_view json, std::size_t position) {
    while (position < json.size() && std::isspace(static_cast<unsigned char>(json[position]))) {
        ++position;
    }
    return position;
}

std::optional<std::string> stringField(std::string_view json, std::string_view key) {
    const std::string marker = "\"" + std::string(key) + "\"";
    const auto keyPosition = json.find(marker);
    if (keyPosition == std::string_view::npos) {
        return std::nullopt;
    }

    const auto colonPosition = json.find(':', keyPosition + marker.size());
    if (colonPosition == std::string_view::npos) {
        return std::nullopt;
    }

    auto position = skipWhitespace(json, colonPosition + 1);
    if (position > json.size() || json[position] != '"') {
        return std::nullopt;
    }
    ++position;

    std::string result;
    while (position < json.size()) {
        const char character = json[position++];
        if (character == '"') {
            return result;
        }
        if (character == '\\' && position < json.size()) {
            const char escaped = json[position++];
            switch (escaped) {
            case '"': result.push_back('"'); break;
            case '\\': result.push_back('\\'); break;
            case 'n': result.push_back('\n'); break;
            case 'r': result.push_back('\r'); break;
            case 't': result.push_back('\t'); break;
            default: result.push_back(escaped); break;
            }
        } else {
            result.push_back(character);
        }
    }

    return std::nullopt;
}

std::optional<std::uint64_t> numberField(std::string_view json, std::string_view key) {
    const std::string marker = "\"" + std::string(key) + "\"";
    const auto keyPosition = json.find(marker);
    if (keyPosition == std::string_view::npos) {
        return std::nullopt;
    }

    auto position = json.find(':', keyPosition + marker.size());
    if (position == std::string_view::npos) {
        return std::nullopt;
    }
    position = skipWhitespace(json, position + 1);
    const auto begin = position;
    while (position < json.size() && std::isdigit(static_cast<unsigned char>(json[position]))) {
        ++position;
    }
    if (begin == position) {
        return std::nullopt;
    }

    const auto tokenEnd = skipWhitespace(json, position);
    if (tokenEnd < json.size() && json[tokenEnd] != ',' && json[tokenEnd] != '}') {
        return std::nullopt;
    }

    std::uint64_t value{};
    const auto parsed = std::from_chars(json.data() + begin, json.data() + position, value);
    return parsed.ec == std::errc{} ? std::optional{value} : std::nullopt;
}

}  // namespace

std::optional<Request> parseRequest(std::string_view json) {
    const auto type = stringField(json, "type");
    const auto requestId = stringField(json, "requestId");
    if (!type.has_value() || !requestId.has_value()) {
        return std::nullopt;
    }

    return Request{
        .type = *type,
        .requestId = *requestId,
        .kind = stringField(json, "kind"),
        .componentId = numberField(json, "componentId"),
        .connectionId = numberField(json, "connectionId"),
        .port = stringField(json, "port"),
        .sourceComponentId = numberField(json, "sourceComponentId"),
        .sourcePort = stringField(json, "sourcePort"),
        .targetComponentId = numberField(json, "targetComponentId"),
        .targetPort = stringField(json, "targetPort"),
        // 信号值统一是字符串：只接受 JSON 字符串字面量。数字形式是「0/1 是数字、X 是字符串」
        // 那个混用表示的遗留，数字也无法表达多位值，因此不再回退到它。
        .value = stringField(json, "value"),
    };
}

std::string escapeJson(std::string_view value) {
    std::string result;
    for (const char character : value) {
        switch (character) {
        case '"': result += "\\\""; break;
        case '\\': result += "\\\\"; break;
        case '\n': result += "\\n"; break;
        case '\r': result += "\\r"; break;
        case '\t': result += "\\t"; break;
        default: result.push_back(character); break;
        }
    }
    return result;
}

std::string errorResponse(
    std::string_view requestId, std::string_view code, std::string_view message) {
    return "{\"type\":\"error\",\"requestId\":\"" + escapeJson(requestId) +
           "\",\"code\":\"" + escapeJson(code) + "\",\"message\":\"" +
           escapeJson(message) + "\"}";
}

}  // namespace circuit::protocol
