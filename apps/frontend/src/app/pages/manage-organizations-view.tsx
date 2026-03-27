import { useState } from 'react';
import { useAppContext, Organization, ScopeNode, Participant } from '../context/app-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Plus, Upload, Search, Edit2, Lock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { toast } from 'sonner';
import { Tree, TreeNode } from 'react-organizational-chart';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';

export function ManageOrganizationsView() {
  const { organizations, addOrganization, updateOrganization } = useAppContext();

  // Register Organization State
  const [orgName, setOrgName] = useState('');
  const [preferredOrgId, setPreferredOrgId] = useState('');
  const [userOrgId, setUserOrgId] = useState('');
  const [importMethod, setImportMethod] = useState<'manual' | 'csv'>('manual');
  const [manualParticipants, setManualParticipants] = useState<
    { personalId: string; contact: string }[]
  >([{ personalId: '', contact: '' }]);

  // Manage Organizations State
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterScope, setFilterScope] = useState('all');
  const [filterRole, setFilterRole] = useState('all');
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [newNodeName, setNewNodeName] = useState('');

  const selectedOrg = organizations.find((org) => org.id === selectedOrgId);

  const handleAddParticipantRow = () => {
    setManualParticipants([...manualParticipants, { personalId: '', contact: '' }]);
  };

  const handleParticipantChange = (index: number, field: string, value: string) => {
    const updated = [...manualParticipants];
    updated[index] = { ...updated[index], [field]: value };
    setManualParticipants(updated);
  };

  const handleRegisterOrganization = () => {
    if (!orgName || !userOrgId) {
      toast.error('Please fill in all required fields');
      return;
    }

    const participants: Participant[] = manualParticipants
      .filter((p) => p.personalId && p.contact)
      .map((p, idx) => ({
        id: `p-${Date.now()}-${idx}`,
        personalId: p.personalId,
        contact: p.contact,
        role: 'Voter',
        scope: 0,
      }));

    // Add organizer
    participants.push({
      id: `p-organizer-${Date.now()}`,
      personalId: userOrgId,
      contact: 'organizer@example.com',
      role: 'Organizer',
      scope: 0,
    });

    const scopeTree: ScopeNode = {
      id: 'root',
      name: 'Root',
      scope: 0,
      children: [],
    };

    const newOrg: Organization = {
      id: `org-${Date.now()}`,
      name: orgName,
      orgId: preferredOrgId || `ORG${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
      userOrgId,
      userRole: 'Organizer',
      userScope: 0,
      participants,
      scopeTree,
    };

    addOrganization(newOrg);
    toast.success('Organization registered successfully!');

    // Reset form
    setOrgName('');
    setPreferredOrgId('');
    setUserOrgId('');
    setManualParticipants([{ personalId: '', contact: '' }]);
  };

  const renderTreeNode = (node: ScopeNode, userScope: number): React.ReactElement => {
    const isLocked = node.scope < userScope;

    return (
      <TreeNode
        label={
          <ContextMenu>
            <ContextMenuTrigger>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={`px-4 py-2 border rounded-lg ${
                        isLocked
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-white hover:bg-blue-50 cursor-pointer border-blue-200'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isLocked && <Lock className="h-3 w-3" />}
                        <span className="text-sm">{node.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">Scope {node.scope}</span>
                    </div>
                  </TooltipTrigger>
                  {isLocked && (
                    <TooltipContent>
                      <p>This node is above your scope level and cannot be modified</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </ContextMenuTrigger>
            {!isLocked && (
              <ContextMenuContent>
                <ContextMenuItem onClick={() => handleAddChildNode(node.id)}>
                  Add Child Node
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => {
                    setEditingNode(node.id);
                    setNewNodeName(node.name);
                  }}
                >
                  Rename
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleDeleteNode(node.id)}>
                  Delete
                </ContextMenuItem>
              </ContextMenuContent>
            )}
          </ContextMenu>
        }
      >
        {node.children.map((child) => renderTreeNode(child, userScope))}
      </TreeNode>
    );
  };

  const handleAddChildNode = (parentId: string) => {
    if (!selectedOrg) return;

    const addChild = (node: ScopeNode): ScopeNode => {
      if (node.id === parentId) {
        const newChild: ScopeNode = {
          id: `node-${Date.now()}`,
          name: `New Node ${node.children.length + 1}`,
          scope: node.scope + 1,
          children: [],
        };
        return { ...node, children: [...node.children, newChild] };
      }
      return { ...node, children: node.children.map(addChild) };
    };

    const updatedTree = addChild(selectedOrg.scopeTree);
    updateOrganization(selectedOrgId, { scopeTree: updatedTree });
    toast.success('Node added successfully');
  };

  const handleDeleteNode = (nodeId: string) => {
    if (!selectedOrg || nodeId === 'root') return;

    const deleteNode = (node: ScopeNode): ScopeNode => {
      return {
        ...node,
        children: node.children.filter((child) => child.id !== nodeId).map(deleteNode),
      };
    };

    const updatedTree = deleteNode(selectedOrg.scopeTree);
    updateOrganization(selectedOrgId, { scopeTree: updatedTree });
    toast.success('Node deleted successfully');
  };

  const handleRenameNode = () => {
    if (!selectedOrg || !editingNode || !newNodeName) return;

    const renameNode = (node: ScopeNode): ScopeNode => {
      if (node.id === editingNode) {
        return { ...node, name: newNodeName };
      }
      return { ...node, children: node.children.map(renameNode) };
    };

    const updatedTree = renameNode(selectedOrg.scopeTree);
    updateOrganization(selectedOrgId, { scopeTree: updatedTree });
    setEditingNode(null);
    setNewNodeName('');
    toast.success('Node renamed successfully');
  };

  const filteredParticipants = selectedOrg?.participants.filter((p) => {
    const matchesSearch =
      p.personalId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.contact.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesScope = filterScope === 'all' || p.scope === parseInt(filterScope);
    const matchesRole = filterRole === 'all' || p.role === filterRole;
    return matchesSearch && matchesScope && matchesRole;
  });

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="mb-2">Manage Organizations</h1>
        <p className="text-muted-foreground">
          Register new organizations or manage existing ones
        </p>
      </div>

      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register">Register New Organization</TabsTrigger>
          <TabsTrigger value="manage">Manage Existing Organizations</TabsTrigger>
        </TabsList>

        {/* Register Organization Tab */}
        <TabsContent value="register" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Organization Details</CardTitle>
              <CardDescription>Provide basic information about the organization</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="orgName">
                  Organization Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="orgName"
                  placeholder="e.g., TechCorp Inc."
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="preferredOrgId">
                  Preferred ORG ID <span className="text-muted-foreground">(Optional)</span>
                </Label>
                <Input
                  id="preferredOrgId"
                  placeholder="ABC1234 (3 Letters, 4 Digits)"
                  value={preferredOrgId}
                  onChange={(e) => setPreferredOrgId(e.target.value)}
                  maxLength={7}
                />
                <p className="text-sm text-muted-foreground">
                  Leave empty to auto-generate an ID
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="userOrgId">
                  Your ORG ID <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="userOrgId"
                  placeholder="Your personal organization ID"
                  value={userOrgId}
                  onChange={(e) => setUserOrgId(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Participant Import</CardTitle>
              <CardDescription>Add participants to your organization</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs value={importMethod} onValueChange={(v) => setImportMethod(v as any)}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="manual">Manual Entry</TabsTrigger>
                  <TabsTrigger value="csv">CSV Import</TabsTrigger>
                </TabsList>

                <TabsContent value="manual" className="mt-4">
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm text-muted-foreground mb-2">
                      <div>Personal ID</div>
                      <div>Email/Mobile</div>
                    </div>
                    {manualParticipants.map((p, idx) => (
                      <div key={idx} className="grid grid-cols-2 gap-3">
                        <Input
                          placeholder="Personal ID"
                          value={p.personalId}
                          onChange={(e) =>
                            handleParticipantChange(idx, 'personalId', e.target.value)
                          }
                        />
                        <Input
                          placeholder="Email or Mobile"
                          value={p.contact}
                          onChange={(e) => handleParticipantChange(idx, 'contact', e.target.value)}
                        />
                      </div>
                    ))}
                    <Button variant="outline" onClick={handleAddParticipantRow} className="w-full">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Row
                    </Button>
                    <p className="text-sm text-muted-foreground">
                      Role defaults to 'Voter' and Scope to '0'. You'll be assigned 'Organizer' role
                      automatically.
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="csv" className="mt-4">
                  <div className="border-2 border-dashed rounded-lg p-8 text-center">
                    <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-sm text-muted-foreground mb-2">
                      Upload a CSV file with columns: Personal ID, Email/Mobile
                    </p>
                    <Button variant="outline">
                      <Upload className="mr-2 h-4 w-4" />
                      Choose File
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleRegisterOrganization} size="lg" className="px-8">
              Register Organization
            </Button>
          </div>
        </TabsContent>

        {/* Manage Organizations Tab */}
        <TabsContent value="manage" className="mt-6">
          {organizations.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No organizations yet. Register your first organization to get started.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="mb-4">
                <Label htmlFor="selectOrg">Select Organization</Label>
                <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                  <SelectTrigger id="selectOrg">
                    <SelectValue placeholder="Choose an organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name} ({org.orgId})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedOrg && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left Pane - Participants */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Participant Management</CardTitle>
                      <CardDescription>
                        Manage users in {selectedOrg.name}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search participants..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9"
                          />
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Select value={filterScope} onValueChange={setFilterScope}>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Filter by Scope" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Scopes</SelectItem>
                            <SelectItem value="0">Scope 0</SelectItem>
                            <SelectItem value="1">Scope 1</SelectItem>
                            <SelectItem value="2">Scope 2</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={filterRole} onValueChange={setFilterRole}>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Filter by Role" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Roles</SelectItem>
                            <SelectItem value="Organizer">Organizer</SelectItem>
                            <SelectItem value="Voter">Voter</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="border rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>ID</TableHead>
                              <TableHead>Contact</TableHead>
                              <TableHead>Role</TableHead>
                              <TableHead>Scope</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredParticipants && filteredParticipants.length > 0 ? (
                              filteredParticipants.map((participant) => (
                                <TableRow key={participant.id} className="cursor-pointer hover:bg-muted/50">
                                  <TableCell className="font-mono text-sm">
                                    {participant.personalId}
                                  </TableCell>
                                  <TableCell className="text-sm">{participant.contact}</TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={
                                        participant.role === 'Organizer' ? 'default' : 'secondary'
                                      }
                                    >
                                      {participant.role}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>{participant.scope}</TableCell>
                                </TableRow>
                              ))
                            ) : (
                              <TableRow>
                                <TableCell colSpan={4} className="text-center text-muted-foreground">
                                  No participants found
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>

                      <Button
                        variant="outline"
                        onClick={() => setShowAddParticipant(true)}
                        className="w-full"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add Participant
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Right Pane - Scope Tree */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Organizational Hierarchy</CardTitle>
                      <CardDescription>
                        Visual tree of scopes (Right-click nodes to manage)
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="border rounded-lg p-4 bg-gray-50 overflow-x-auto">
                        <Tree
                          lineWidth="2px"
                          lineColor="#cbd5e1"
                          lineBorderRadius="10px"
                          label={
                            <div className="px-4 py-2 border-2 border-[#1e40af] rounded-lg bg-blue-50">
                              <span className="text-sm">{selectedOrg.name}</span>
                              <br />
                              <span className="text-xs text-muted-foreground">Root</span>
                            </div>
                          }
                        >
                          {selectedOrg.scopeTree.children.map((child) =>
                            renderTreeNode(child, selectedOrg.userScope)
                          )}
                        </Tree>
                        {selectedOrg.scopeTree.children.length === 0 && (
                          <div className="text-center py-8 text-muted-foreground">
                            <p className="mb-4">No organizational structure yet</p>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleAddChildNode('root')}
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Add First Node
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Rename Node Dialog */}
      <Dialog open={!!editingNode} onOpenChange={() => setEditingNode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Node</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="nodeName">Node Name</Label>
              <Input
                id="nodeName"
                value={newNodeName}
                onChange={(e) => setNewNodeName(e.target.value)}
                placeholder="Enter new name"
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setEditingNode(null)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleRenameNode} className="flex-1">
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
