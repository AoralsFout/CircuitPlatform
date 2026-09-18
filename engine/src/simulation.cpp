#include "circuit/simulation.hpp"

#include <algorithm>
#include <unordered_map>
#include <utility>

namespace circuit {
namespace {

// 在仿真快照中查找元件，供输入校验和端口解析复用。
const Component* findComponent(const std::vector<Component>& components, ComponentId id) {
    const auto found = std::find_if(
        components.begin(), components.end(),
        [id](const Component& component) { return component.id == id; });
    return found == components.end() ? nullptr : &*found;
}

// 根据元件身份和端口名称解析端口；失效引用由调用者解释为未知或悬空。
const Port* findPort(const std::vector<Component>& components, const PortId& portId) {
    const auto* component = findComponent(components, portId.component);
    if (component == nullptr) {
        return nullptr;
    }

    const auto found = std::find_if(
        component->ports.begin(), component->ports.end(),
        [&portId](const Port& port) { return port.name == portId.name; });
    return found == component->ports.end() ? nullptr : &*found;
}

// 比较两个端口身份，避免把端口的字符串和所属元件比较逻辑散落在各处。
bool samePort(const PortId& left, const PortId& right) {
    return left.component == right.component && left.name == right.name;
}

// 以下是三值逻辑的逐位原语：参数是 `0` / `1` / `X` 中的一个字符，返回同一位置的字符。
// 拆到位这一层是因为四个值运算都只是把逐位规则套在整值上，规则本身只有这一份。

// NOT 只翻转确定的 0 和 1，未知位保持未知。
char invertBit(char bit) {
    if (bit == '0') return '1';
    if (bit == '1') return '0';
    return 'X';
}

// AND 的某一位是 0 就确定这一位是 0，且只有两位都是 1 时才是 1。
char andBit(char left, char right) {
    if (left == '0' || right == '0') return '0';
    return left == '1' && right == '1' ? '1' : 'X';
}

// OR 的某一位是 1 就确定这一位是 1，且只有两位都是 0 时才是 0。
char orBit(char left, char right) {
    if (left == '1' || right == '1') return '1';
    return left == '0' && right == '0' ? '0' : 'X';
}

// XOR 的某一位在任一输入未知时无法确定，两位都确定时相异为 1。
char xorBit(char left, char right) {
    if (left == 'X' || right == 'X') return 'X';
    return left == right ? '0' : '1';
}

// Clock 的每一次推进都在「整值全 0」与「整值全 1」之间翻转，长度等于端口位宽。
// 1 位时这就是普通的 0/1 翻转；从 X 起步同样落到全 1，因此第一次推进必然是 0 → 1。
// 长度取端口位宽而不是常量 1：位宽大于 1 的 Clock 若写出 1 个字符，那个端口的值长度就永远
// 对不上它自己的位宽了。
SignalValue flippedClockValue(const SignalValue& current, std::size_t width) {
    const bool allOnes = current.bits().find_first_not_of('1') == std::string::npos;
    return SignalValue::fromBits(std::string(width, allOnes ? '0' : '1'));
}

// 把逐位规则套在整值上：结果与输入同位宽，每一位只由两个输入的同一位置决定。
// 两个值的位宽必须相同——同一条 Connection 的两端声明同一个位宽。长度不等是结构错误，
// 位宽校验会挡住产生它的连接，因此这里退回「整值未知」而不是静默产出一个长度对不上的结果。
template <typename Operation>
SignalValue bitwiseBinary(const SignalValue& left, const SignalValue& right, Operation operation) {
    const auto& leftBits = left.bits();
    const auto& rightBits = right.bits();
    if (leftBits.size() != rightBits.size()) {
        return SignalValue::unknown(std::max(leftBits.size(), rightBits.size()));
    }

    std::string bits = leftBits;
    for (std::size_t index = 0; index < bits.size(); ++index) {
        bits[index] = operation(leftBits[index], rightBits[index]);
    }
    return SignalValue::fromBits(std::move(bits));
}

// NOT 门：逐位翻转，某一位未知不影响其余位。
SignalValue invert(SignalValue value) {
    std::string bits = value.bits();
    for (char& bit : bits) {
        bit = invertBit(bit);
    }
    return SignalValue::fromBits(std::move(bits));
}

// AND 门：每一位独立求值，一位是 0 就让这一位确定是 0，不受另一位未知的影响。
SignalValue andValue(SignalValue left, SignalValue right) {
    return bitwiseBinary(left, right, andBit);
}

// OR 门：每一位独立求值，一位是 1 就让这一位确定是 1，不受另一位未知的影响。
SignalValue orValue(SignalValue left, SignalValue right) {
    return bitwiseBinary(left, right, orBit);
}

// XOR 门：任一位的任一输入未知时这一位无法确定，其余位照常参与求值。
SignalValue xorValue(SignalValue left, SignalValue right) {
    return bitwiseBinary(left, right, xorBit);
}

// 按元件类型遍历：tick 与 signalSnapshot 都要在整份电路里挑出某一类元件。
// 模板在调用点完全内联，逐元素执行的代码与手写循环一致，没有额外开销。
template <typename Visit>
void forEachComponentOfKind(
    const std::vector<Component>& components, ComponentKind kind, Visit&& visit) {
    for (const auto& component : components) {
        if (component.kind == kind) {
            visit(component);
        }
    }
}

// 以「输出端口」为单位遍历整份电路：状态表的建立与重建都以端口为粒度。
template <typename Visit>
void forEachOutputPort(const std::vector<Component>& components, Visit&& visit) {
    for (const auto& component : components) {
        for (const auto& port : component.ports) {
            if (port.direction == PortDirection::Output) {
                visit(component, port);
            }
        }
    }
}

bool isCombinational(ComponentKind kind) {
    switch (kind) {
    case ComponentKind::AndGate:
    case ComponentKind::OrGate:
    case ComponentKind::NandGate:
    case ComponentKind::NorGate:
    case ComponentKind::XorGate:
    case ComponentKind::XnorGate:
    case ComponentKind::NotGate:
        return true;
    default:
        return false;
    }
}

// DFS 的访问状态用于区分尚未访问、当前路径和已经完成的组件。
enum class VisitState {
    Unvisited,
    Visiting,
    Visited,
};

// 集中分派所有二输入门，保持 settle 只负责读取输入和传播输出。
std::optional<SignalValue> evaluateBinaryGate(
    ComponentKind kind, SignalValue left, SignalValue right) {
    switch (kind) {
    case ComponentKind::AndGate:
        return andValue(left, right);
    case ComponentKind::OrGate:
        return orValue(left, right);
    case ComponentKind::NandGate:
        return invert(andValue(left, right));
    case ComponentKind::NorGate:
        return invert(orValue(left, right));
    case ComponentKind::XorGate:
        return xorValue(left, right);
    case ComponentKind::XnorGate:
        return invert(xorValue(left, right));
    default:
        return std::nullopt;
    }
}

}  // namespace

// 端口读不到值时按它自己声明的位宽给出全 X。位宽是 Port 的属性，长度对不上就不是这个端口的值。
SignalValue unknownPortValue(const std::vector<Component>& components, const PortId& portId) {
    const auto* port = findPort(components, portId);
    return SignalValue::unknown(port == nullptr ? 1 : port->width);
}

// Clock 的输出初值必须是 0：只有 0 → 1 算上升沿，从 X 起步会永远判不出第一次上升沿。
// 位宽大于 1 时对应的是等宽的整值全 0，而不是单个 `0`——端口的初值长度永远等于它的位宽。
SignalValue initialOutputValue(ComponentKind kind, std::size_t width) {
    return kind == ComponentKind::Clock ? SignalValue::fromBits(std::string(width, '0'))
                                        : SignalValue::unknown(width);
}

// 建立仿真状态，并把每个输出端初始化为该元件类型的初值。
Simulation::Simulation(const Circuit& circuit) : circuit_(circuit) {
    initializeOutputSignals();
}

// 按当前 Circuit 重建输出信号表；构造与重置共用同一段「初值长什么样」的规则。
void Simulation::initializeOutputSignals() {
    signals_.clear();
    forEachOutputPort(circuit_.components_, [this](const Component& component, const Port& port) {
        signals_.push_back({{component.id, port.name}, initialOutputValue(component.kind, port.width)});
    });
}

// 结构变更后按元件身份重新推导状态：PortId 没变的端口留着当前值，消失的丢掉，新出现的按初值建立。
// 按身份保留之所以安全，是因为元件身份单调递增、永不重用——同一个 id 不会换一个元件回来。
// 保留还多一个前提：值的长度必须等于端口当前的位宽。改宽后的端口留着旧长度就成了一条永远
// 对不上端口的陈旧值，因此位宽变了的端口按初值重建——旧值不以任何形式保留。
void Simulation::reconcile() {
    std::vector<PortSignal> reconciled;
    reconciled.reserve(signals_.size());

    forEachOutputPort(circuit_.components_, [this, &reconciled](const Component& component, const Port& port) {
        const PortId portId{component.id, port.name};
        const auto kept = std::find_if(
            signals_.begin(), signals_.end(),
            [&portId](const PortSignal& signal) { return samePort(signal.port, portId); });
        const bool reusable = kept != signals_.end() && kept->value.width() == port.width;
        reconciled.push_back(reusable ? *kept
                                      : PortSignal{portId, initialOutputValue(component.kind, port.width)});
    });

    signals_ = std::move(reconciled);

    // 已删除的 DFlipFlop 不能把它的时钟前值留在表里。残留既不可达也不会自行释放，
    // 因此这里主动裁剪，让这张表的规模始终与当前电路里实际存在的 DFlipFlop 一致。
    previousClockValues_.erase(
        std::remove_if(
            previousClockValues_.begin(), previousClockValues_.end(),
            [this](const PortSignal& previous) {
                const auto* component = findComponent(circuit_.components_, previous.port.component);
                if (component == nullptr || component->kind != ComponentKind::DFlipFlop) {
                    return true;
                }
                return findPort(circuit_.components_, previous.port) == nullptr;
            }),
        previousClockValues_.end());
}

// 重置等价于「用同一份 Circuit 重新构造一个 Simulation」：唯一不重建的是 Circuit 本身，
// 因为元件与连接的引擎身份属于 Circuit，不能随运行时状态一起丢掉。
// 前值快照同样必须清空——新建的 Simulation 里它是空的；若留下重置前的值，重置后的第一次
// 推进就会拿旧前值与新端口值比较，可能凭空造出一个上升沿，也可能漏掉真正的 0 → 1。
void Simulation::reset() {
    initializeOutputSignals();
    previousClockValues_.clear();
    step_ = 0;
}

// Input 是仿真外部的驱动源，因此只能通过元件身份修改它的输出值。
bool Simulation::setInput(ComponentId inputId, SignalValue value) {
    const auto* component = findComponent(circuit_.components_, inputId);
    if (component == nullptr || component->kind != ComponentKind::Input) {
        return false;
    }

    setOutputSignal({inputId, "out"}, value);
    return true;
}

// 反复计算 NOT 门，直到本轮没有输出变化或达到稳定化上限。
SimulationResult Simulation::settle() {
    // 先检查结构环路，再执行求值，避免把“未变化”误判为“已稳定”。
    std::unordered_map<ComponentId, VisitState> states;
    const auto visitsLoop = [&](auto&& self, ComponentId componentId) -> bool {
        auto& state = states[componentId];
        if (state == VisitState::Visiting) {
            return true;
        }
        if (state == VisitState::Visited) {
            return false;
        }

        state = VisitState::Visiting;
        for (const auto& connection : circuit_.connections_) {
            if (connection.source.component != componentId) {
                continue;
            }

            const auto* target = findComponent(circuit_.components_, connection.target.component);
            if (target != nullptr && isCombinational(target->kind) &&
                self(self, target->id)) {
                return true;
            }
        }

        state = VisitState::Visited;
        return false;
    };

    for (const auto& component : circuit_.components_) {
        if (isCombinational(component.kind) && visitsLoop(visitsLoop, component.id)) {
            return {SimulationError::CombinationalLoop};
        }
    }

    const auto iterationLimit = circuit_.components_.size() + circuit_.connections_.size() + 1;

    for (std::size_t iteration = 0; iteration < iterationLimit; ++iteration) {
        bool changed = false;

        for (const auto& component : circuit_.components_) {
            if (component.kind == ComponentKind::NotGate) {
                const auto input = signal({component.id, "in"}).value_or(unknownPortValue(circuit_.components_, {component.id, "in"}));
                changed = setOutputSignal({component.id, "out"}, invert(input)) || changed;
            } else {
                const auto first = signal({component.id, "in1"}).value_or(unknownPortValue(circuit_.components_, {component.id, "in1"}));
                const auto second = signal({component.id, "in2"}).value_or(unknownPortValue(circuit_.components_, {component.id, "in2"}));
                const auto output = evaluateBinaryGate(component.kind, first, second);
                if (output.has_value()) {
                    changed = setOutputSignal({component.id, "out"}, *output) || changed;
                }
            }
        }

        if (!changed) {
            return {SimulationError::None};
        }
    }

    return {SimulationError::CombinationalLoop};
}

// 六步顺序本身就是语义：先记前值，再推进时钟，求值到稳定后才判上升沿，判完再求值一次。
SimulationResult Simulation::tick() {
    // ① 为还没有前值的 DFlipFlop 建立快照。前值的含义是「上一 tick 求值稳定之后观测到的
    //    值」，不是「本 tick 开始时读一次」：只有第一次见到某个 DFlipFlop 时才现读一次，
    //    其后一律沿用第 ④ 步在上一次推进末尾写回的值。驱动 clock 端口的可能是 Input 元件，
    //    它的电平变化发生在两次 tick 之间，现读会把这期间的 0 → 1 吞掉，永远认不出这类
    //    上升沿。Phase 5.5 展平 Subcircuit 后外部时钟正是接到内部 Input 元件上。
    forEachComponentOfKind(circuit_.components_, ComponentKind::DFlipFlop, [this](const Component& component) {
        const PortId clockPort{component.id, "clock"};
        const auto tracked = std::any_of(
            previousClockValues_.begin(), previousClockValues_.end(),
            [&clockPort](const PortSignal& signal) { return samePort(signal.port, clockPort); });
        if (!tracked) {
            previousClockValues_.push_back({clockPort, signal(clockPort).value_or(unknownPortValue(circuit_.components_, clockPort))});
        }
    });

    // ② 推进每个 Clock 元件：out 在 0 与 1 之间翻转。初值是 0，因此第一次推进必然是 0 → 1。
    forEachComponentOfKind(circuit_.components_, ComponentKind::Clock, [this](const Component& component) {
        const PortId outPort{component.id, "out"};
        const auto* port = findPort(circuit_.components_, outPort);
        setOutputSignal(outPort, flippedClockValue(outputSignal(outPort), port == nullptr ? 1 : port->width));
    });

    // ③ 组合求值到稳定，让新的时钟电平经组合逻辑传播到 DFlipFlop 的 clock 端口。
    if (const auto advance = settle(); !advance.succeeded()) {
        return advance;
    }

    // ④ DFlipFlop 的上升沿采样：比较前值与 clock 端口的当前值。
    //    只有 0 → 1 算上升沿；1 → 0 不采样，任何一端是 X 的跳变也不采样——
    //    X → 1 无法构成可靠的上升沿，因为上一拍可能本来就是 1。
    //    判定只读端口的前后值，与元件类型无关：Clock、Input 或组合逻辑的输出都一样。
    for (auto& previous : previousClockValues_) {
        const auto current = signal(previous.port).value_or(unknownPortValue(circuit_.components_, previous.port));
        // 这是「整值从全 0 变成全 1」的比较，在 1 位端口上是「该位 0 → 1」的特例：
        // 每一位独立判定（哪一位出现上升沿就采哪一位的 d）要等位宽进来、端口能声明位宽之后
        // 才有意义，那时这里的整值比较会因 `"0"` 与 `"00"` 这类长度差异静默失效。
        if (previous.value == SignalValue::zero() && current == SignalValue::one()) {
            // 采样的是第 ③ 步求值稳定之后的 d：时钟可以经组合逻辑到达 clock 端口，
            // 数据同样可能经组合逻辑到达 d，两者都必须在采样那一刻处在稳定值上。
            const auto data = signal({previous.port.component, "d"}).value_or(unknownPortValue(circuit_.components_, {previous.port.component, "d"}));
            setOutputSignal({previous.port.component, "q"}, data);
        }

        // 记下本次 tick 观测到的值，作为下一 tick 的前值。
        previous.value = current;
    }

    // ⑤ 再次组合求值到稳定，让采样后的 q 变化传播到下游。
    if (const auto propagated = settle(); !propagated.succeeded()) {
        return propagated;
    }

    // ⑥ tick 计数自增。
    ++step_;
    return {SimulationError::None};
}

std::uint64_t Simulation::step() const noexcept {
    return step_;
}

std::size_t Simulation::trackedClockCountForTesting() const noexcept {
    return previousClockValues_.size();
}

const std::vector<Simulation::PortSignal>& Simulation::outputSignals() const noexcept {
    return signals_;
}

// 输出端口不足以描述 Output 元件的读数：它的值来自自己的接收端，接收端沿 Connection 推导。
// 把接收端一并放进快照，调用方就能在一次往返里得到全部可展示读数。
std::vector<Simulation::PortSignal> Simulation::signalSnapshot() const {
    std::vector<PortSignal> snapshot = outputSignals();
    forEachComponentOfKind(circuit_.components_, ComponentKind::Output, [this, &snapshot](const Component& component) {
        const PortId receivePort{component.id, "in"};
        snapshot.push_back({receivePort, signal(receivePort).value_or(unknownPortValue(circuit_.components_, receivePort))});
    });
    return snapshot;
}

// 输出端直接读取保存值；输入端沿 Connection 读取来源输出值。
// 读不到来源时按**这个端口自己声明的位宽**给出全 X：长度对不上的值不是这个端口的值。
std::optional<SignalValue> Simulation::signal(PortId portId) const {
    const auto* port = findPort(circuit_.components_, portId);
    if (port == nullptr) {
        return std::nullopt;
    }

    if (port->direction == PortDirection::Output) {
        return outputSignal(portId);
    }

    // 只认两端位宽仍然相同的 Connection。位宽不再匹配的连接与悬空连接是同一种表达——
    // 不参与仿真——因此它不提供来源，输入端读到的是全 X，而不是一条被静默截断的值。
    const auto connection = std::find_if(
        circuit_.connections_.begin(), circuit_.connections_.end(),
        [this, &portId, port](const Connection& candidate) {
            if (!samePort(candidate.target, portId)) {
                return false;
            }
            const auto* sourcePort = findPort(circuit_.components_, candidate.source);
            return sourcePort != nullptr && sourcePort->direction == PortDirection::Output &&
                   sourcePort->width == port->width;
        });
    if (connection == circuit_.connections_.end()) {
        return SignalValue::unknown(port->width);
    }

    return outputSignal(connection->source);
}

// 只更新已知的输出端，并用返回值告诉稳定化循环是否发生了变化。
bool Simulation::setOutputSignal(const PortId& portId, SignalValue value) {
    const auto found = std::find_if(
        signals_.begin(), signals_.end(),
        [&portId](const PortSignal& signal) { return samePort(signal.port, portId); });
    if (found == signals_.end()) {
        return false;
    }

    if (found->value == value) {
        return false;
    }

    found->value = value;
    return true;
}

// 读取输出端的当前值；不存在的内部状态按该端口的位宽给出全 X。
SignalValue Simulation::outputSignal(const PortId& portId) const {
    const auto found = std::find_if(
        signals_.begin(), signals_.end(),
        [&portId](const PortSignal& signal) { return samePort(signal.port, portId); });
    return found == signals_.end() ? unknownPortValue(circuit_.components_, portId) : found->value;
}

}  // namespace circuit
